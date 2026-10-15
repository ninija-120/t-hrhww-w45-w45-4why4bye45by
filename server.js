const express=require('express'),crypto=require('crypto'),Database=require('better-sqlite3');
const SALARY=+process.env.SALARY||300000000, NEED=9e9, START=50000000, DAY=864e5;
const db=new Database(process.env.DB_PATH||'game.db');
const DR=+process.env.DEP_RATE||.01, LR=+process.env.LOAN_RATE||.05, LIST_FEE=+process.env.LIST_FEE||1e8;
db.exec(`create table if not exists users(id integer primary key,username text unique,salt text,hash text,balance real default ${START},last_salary integer default 0,exchange integer default 0);
create table if not exists sessions(token text primary key,uid integer);
create table if not exists holdings(uid integer,sym text,amt real default 0,primary key(uid,sym));
create table if not exists exchanges(id integer primary key,name text,owner integer,salt text,hash text,fee real default 0.002,earned real default 0,volume real default 0,trades integer default 0);`);
try{db.exec('alter table exchanges add column bankrupt integer default 0')}catch(e){}
db.exec(`create table if not exists complaints(id integer primary key,ex integer,uid integer,text text,status text default 'open',reply text,created integer);create table if not exists ex_users(ex integer,uid integer,primary key(ex,uid));
create table if not exists bank(uid integer primary key,dep real default 0,loan real default 0,ts integer default 0);
create table if not exists custom_coins(sym text primary key,name text,price real,open real,ex integer);`);
if(!db.prepare('select 1 from exchanges').get())db.prepare("insert into exchanges(name,owner,salt,hash) values('صرافی مرکزی',0,'','')").run();
const coins={BTC:['بیت‌کوین',6.5e9],ETH:['اتریوم',2.5e8],USDT:['تتر',105000],TRX:['ترون',15000],DOGE:['دوج‌کوین',20000]};
const mk={};for(const s in coins)mk[s]={name:coins[s][0],price:coins[s][1],open:coins[s][1],ex:0};
db.prepare('select * from custom_coins').all().forEach(c=>mk[c.sym]={name:c.name,price:c.price,open:c.open,ex:c.ex});
setInterval(()=>{for(const s in mk){const m=mk[s],v=s==='USDT'?.002:.012;m.price=Math.max(1,m.price*(1+(Math.random()-.5)*2*v))}},5000);
setInterval(()=>{for(const s in mk)mk[s].open=mk[s].price},DAY);
setInterval(()=>{const st=db.prepare('update custom_coins set price=?,open=? where sym=?');for(const s in mk)if(mk[s].ex)st.run(mk[s].price,mk[s].open,s)},30000);
const app=express();app.use(express.json());app.use(express.static('public'));
const bad=s=>/[<>&"'`\\]/.test(s);
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const wrap=f=>(q,r)=>{try{f(q,r)}catch(e){r.status(400).json({error:e.message})}};
const auth=(q,r,n)=>{const t=(q.headers.authorization||'').slice(7);const s=db.prepare('select uid from sessions where token=?').get(t);
 if(!s)return r.status(401).json({error:'وارد حساب خود شوید'});q.uid=s.uid;n()};
const accrue=uid=>{const b=db.prepare('select * from bank where uid=?').get(uid),now=Date.now();
 if(!b){db.prepare('insert into bank(uid,ts) values(?,?)').run(uid,now);return{dep:0,loan:0}}
 const k=(now-b.ts)/DAY;if(k<=0||(!b.dep&&!b.loan)){db.prepare('update bank set ts=? where uid=?').run(now,uid);return b}
 const dep=b.dep*Math.pow(1+DR,k),loan=b.loan*Math.pow(1+LR,k);db.prepare('update bank set dep=?,loan=?,ts=? where uid=?').run(dep,loan,now,uid);return{dep,loan}};
const wealth=uid=>{const u=db.prepare('select balance from users where id=?').get(uid),b=accrue(uid);
 return u.balance+b.dep-b.loan+db.prepare('select sym,amt from holdings where uid=?').all(uid).reduce((s,h)=>s+h.amt*(mk[h.sym]?.price||0),0)};
const login=uid=>{const t=crypto.randomBytes(24).toString('hex');db.prepare('insert into sessions values(?,?)').run(t,uid);return t};
const view=uid=>{const u=db.prepare('select username,balance,last_salary,exchange from users where id=?').get(uid);
 const b=accrue(uid);return{...u,dep:b.dep,loan:b.loan,dr:DR,lr:LR,lf:LIST_FEE,mine:db.prepare('select id,name,fee,earned,volume,trades,bankrupt from exchanges where owner=?').all(uid),salary:SALARY,need:NEED,next:u.last_salary+DAY,hold:db.prepare('select sym,amt from holdings where uid=? and amt>0').all(uid)}};
app.post('/api/signup',wrap((q,r)=>{const{username:u,password:p}=q.body;
 if(!/^[a-zA-Z0-9_]{3,20}$/.test(u||''))throw Error('نام کاربری ۳ تا ۲۰ حرف انگلیسی/عدد باشد');
 if((p||'').length<6)throw Error('رمز عبور حداقل ۶ کاراکتر باشد');
 if(db.prepare('select 1 from users where username=?').get(u))throw Error('این نام کاربری گرفته شده');
 const s=crypto.randomBytes(8).toString('hex');const id=db.prepare('insert into users(username,salt,hash) values(?,?,?)').run(u,s,hash(p,s)).lastInsertRowid;
 r.json({token:login(id)})}));
app.post('/api/login',wrap((q,r)=>{const u=db.prepare('select * from users where username=?').get(q.body.username||'');
 if(!u||hash(q.body.password||'',u.salt)!==u.hash)throw Error('نام کاربری یا رمز اشتباه است');r.json({token:login(u.id)})}));
app.get('/api/me',auth,(q,r)=>r.json(view(q.uid)));
app.post('/api/salary',auth,wrap((q,r)=>{const u=db.prepare('select last_salary from users where id=?').get(q.uid);
 if(Date.now()<u.last_salary+DAY)throw Error('حقوق امروز را گرفته‌اید');
 db.transaction(()=>{const b=accrue(q.uid),pay=Math.min(b.loan,SALARY/2);
  db.prepare('update users set balance=balance+?,last_salary=? where id=?').run(SALARY-pay,Date.now(),q.uid);
  if(pay>0)db.prepare('update bank set loan=loan-? where uid=?').run(pay,q.uid)})();r.json(view(q.uid))}));
app.post('/api/exchange/create',auth,wrap((q,r)=>{const n=(q.body.name||'').trim(),p=q.body.pass||'';
 if(bad(n))throw Error('نام نباید شامل نمادهای خاص مثل < > & و نقل‌قول باشد');if(n.length<2||n.length>30)throw Error('نام صرافی ۲ تا ۳۰ حرف باشد');if(p.length<6)throw Error('رمز پنل حداقل ۶ کاراکتر باشد');
 db.transaction(()=>{const u=db.prepare('select balance from users where id=?').get(q.uid);
  if(u.balance<NEED)throw Error('برای ساخت صرافی جدید ۹ میلیارد تومان موجودی لازم است');
  const s=crypto.randomBytes(8).toString('hex');db.prepare('update users set balance=balance-? where id=?').run(NEED,q.uid);
  db.prepare('insert into exchanges(name,owner,salt,hash) values(?,?,?,?)').run(n,q.uid,s,hash(p,s))})();
 r.json(view(q.uid))}));
app.get('/api/exchanges',auth,(q,r)=>r.json(db.prepare('select id,name,fee,bankrupt from exchanges').all()));
const bust=id=>{if(id!==1)db.prepare('update exchanges set bankrupt=1,earned=0 where id=?').run(id)};
const tries={},EX='id,name,fee,earned,volume,trades,bankrupt';
app.post('/api/exchange/admin',auth,wrap((q,r)=>{const{id,pass,action,value}=q.body;
 const e=db.prepare('select * from exchanges where id=? and owner=?').get(+id,q.uid);if(!e)throw Error('این صرافی مال شما نیست');
 const t=tries[q.uid]||(tries[q.uid]={n:0,t:Date.now()});if(Date.now()-t.t>6e5){t.n=0;t.t=Date.now()}
 if(t.n>=5)throw Error('تلاش زیاد؛ ۱۰ دقیقه بعد دوباره امتحان کنید');
 if(hash(pass||'',e.salt)!==e.hash){t.n++;throw Error('رمز پنل اشتباه است')}t.n=0;
 if(action==='fee'){const v=+value;if(!(v>=0&&v<=5))throw Error('کارمزد بین ۰ تا ۵ درصد باشد');db.prepare('update exchanges set fee=? where id=?').run(v/100,e.id)}
 else if(action==='rename'){const n=(value||'').trim();if(bad(n))throw Error('نام نباید شامل نمادهای خاص مثل < > & و نقل‌قول باشد');if(n.length<2||n.length>30)throw Error('نام ۲ تا ۳۰ حرف باشد');db.prepare('update exchanges set name=? where id=?').run(n,e.id)}
 else if(action==='withdraw'){db.transaction(()=>{const x=db.prepare('select earned from exchanges where id=?').get(e.id).earned;
  db.prepare('update exchanges set earned=0 where id=?').run(e.id);db.prepare('update users set balance=balance+? where id=?').run(x,q.uid)})()}
 else if(action==='bankrupt'){bust(e.id)}
 else if(action==='coin'){const c=value||{},sym=String(c.sym||'').toUpperCase(),nm=String(c.name||'').trim(),p=+c.price;
  if(!/^[A-Z]{2,6}$/.test(sym))throw Error('نماد ۲ تا ۶ حرف انگلیسی باشد');if(mk[sym])throw Error('این نماد قبلاً وجود دارد');
  if(bad(nm)||nm.length<2||nm.length>20)throw Error('نام ارز ۲ تا ۲۰ حرف و بدون نمادهای خاص باشد');
  if(!(p>=1000&&p<=1e11))throw Error('قیمت اولیه بین ۱۰۰۰ تا ۱۰۰ میلیارد تومان باشد');
  if(Object.values(mk).filter(m=>m.ex===e.id).length>=3)throw Error('حداکثر ۳ ارز برای هر صرافی مجاز است');
  db.transaction(()=>{if(db.prepare('select balance from users where id=?').get(q.uid).balance<LIST_FEE)throw Error('هزینه‌ی لیست ارز '+LIST_FEE.toLocaleString('fa-IR')+' تومان است');
   db.prepare('update users set balance=balance-? where id=?').run(LIST_FEE,q.uid);db.prepare('insert into custom_coins values(?,?,?,?,?)').run(sym,nm,p,p,e.id)})();
  mk[sym]={name:nm,price:p,open:p,ex:e.id}}
 else if(action==='delcoin'){const sym=String(value||'');if(!mk[sym]||mk[sym].ex!==e.id)throw Error('ارز پیدا نشد');
  db.transaction(()=>{const pr=mk[sym].price;db.prepare('select uid,amt from holdings where sym=? and amt>0').all(sym).forEach(h=>db.prepare('update users set balance=balance+? where id=?').run(h.amt*pr,h.uid));
   db.prepare('delete from holdings where sym=?').run(sym);db.prepare('delete from custom_coins where sym=?').run(sym)})();delete mk[sym]}
 else if(action==='pass'){if((value||'').length<6)throw Error('رمز جدید حداقل ۶ کاراکتر');const s=crypto.randomBytes(8).toString('hex');
  db.prepare('update exchanges set salt=?,hash=? where id=?').run(s,hash(value,s),e.id)}
 r.json({ex:db.prepare('select '+EX+' from exchanges where id=?').get(e.id),coins:Object.entries(mk).filter(([s,m])=>m.ex===e.id).map(([sym,m])=>({sym,name:m.name,price:m.price})),me:view(q.uid)})}));
app.get('/api/market',auth,(q,r)=>r.json(Object.entries(mk).map(([sym,m])=>({sym,ex:m.ex,name:m.name,price:m.price,change:(m.price/m.open-1)*100}))));
app.post('/api/trade',auth,wrap((q,r)=>{const{sym,side}=q.body,a=+q.body.amount,m=mk[sym],e=db.prepare('select * from exchanges where id=?').get(+q.body.ex||1);
 if(!m||!(a>0)||!e)throw Error('مقدار نامعتبر');if(m.ex&&m.ex!==e.id)throw Error('این ارز فقط در صرافی خودش معامله می‌شود');if(e.bankrupt)throw Error('این صرافی ورشکسته شده و معامله در آن بسته است');
 db.transaction(()=>{const u=db.prepare('select balance from users where id=?').get(q.uid);
  const h=db.prepare('select amt from holdings where uid=? and sym=?').get(q.uid,sym)?.amt||0;let dBal,dAmt,fee,vol;
  if(side==='buy'){if(a>u.balance)throw Error('موجودی کافی نیست');fee=a*e.fee;vol=a;dBal=-a;dAmt=(a-fee)/m.price}
  else{if(a>h)throw Error('دارایی کافی نیست');vol=a*m.price;fee=vol*e.fee;dBal=vol-fee;dAmt=-a}
  db.prepare('update users set balance=balance+? where id=?').run(dBal,q.uid);
  db.prepare('insert into holdings values(?,?,?) on conflict(uid,sym) do update set amt=amt+?').run(q.uid,sym,Math.max(0,dAmt),dAmt);
  db.prepare('update exchanges set earned=earned+?,volume=volume+?,trades=trades+1 where id=?').run(fee,vol,e.id);
  db.prepare('insert or ignore into ex_users values(?,?)').run(e.id,q.uid)})();
 r.json(view(q.uid))}));

const gate=(k,ok)=>{const t=tries[k]||(tries[k]={n:0,t:Date.now()});if(Date.now()-t.t>6e5){t.n=0;t.t=Date.now()}
 if(t.n>=5)throw Error('تلاش زیاد؛ ۱۰ دقیقه بعد دوباره امتحان کنید');if(!ok()){t.n++;throw Error('رمز اشتباه است')}t.n=0};
app.post('/api/complaint',auth,wrap((q,r)=>{const id=+q.body.ex,t=(q.body.text||'').trim(),e=db.prepare('select * from exchanges where id=?').get(id);
 if(!e)throw Error('صرافی پیدا نشد');if(e.owner===q.uid)throw Error('از صرافی خودتان نمی‌توانید شکایت کنید');
 if(t.length<10||t.length>500)throw Error('متن شکایت ۱۰ تا ۵۰۰ حرف باشد');
 if(!db.prepare('select 1 from ex_users where ex=? and uid=?').get(id,q.uid))throw Error('فقط کسی که در این صرافی معامله کرده می‌تواند شکایت کند');
 if(db.prepare("select 1 from complaints where ex=? and uid=? and status='open'").get(id,q.uid))throw Error('شکایت قبلی شما هنوز بررسی نشده');
 db.prepare('insert into complaints(ex,uid,text,created) values(?,?,?,?)').run(id,q.uid,t,Date.now());
 const n=db.prepare("select count(distinct uid) c from complaints where ex=? and status='open'").get(id).c;if(n>=5)bust(id);
 r.json({ok:1})}));
app.post('/api/central',auth,wrap((q,r)=>{const P=process.env.CENTRAL_PASS;if(!P)throw Error('متغیر CENTRAL_PASS روی سرور تنظیم نشده');
 gate('c'+q.uid,()=>{const a=Buffer.from(String(q.body.pass||'')),b=Buffer.from(P);return a.length===b.length&&crypto.timingSafeEqual(a,b)});
 const{action:x,id,value}=q.body;
 if(x==='resolve')db.prepare("update complaints set status='resolved',reply=? where id=?").run(String(value||'').slice(0,300),+id);
 else if(x==='bankrupt')bust(+id);
 else if(x==='reinstate'){db.prepare('update exchanges set bankrupt=0 where id=?').run(+id);db.prepare("update complaints set status='resolved',reply='صرافی بازگشایی شد' where ex=? and status='open'").run(+id)}
 r.json({complaints:db.prepare('select c.id,c.ex,e.name exname,u.username,c.text,c.status,c.reply from complaints c join exchanges e on e.id=c.ex join users u on u.id=c.uid order by c.id desc limit 100').all(),
  ex:db.prepare('select id,name,owner,bankrupt,fee,earned,volume,trades from exchanges').all()})}));
app.post('/api/bank',auth,wrap((q,r)=>{const a=Math.floor(+q.body.amount),x=q.body.action;if(!(a>0))throw Error('مبلغ نامعتبر است');
 db.transaction(()=>{const b=accrue(q.uid),u=db.prepare('select balance from users where id=?').get(q.uid),
  up=(bal,dep,loan)=>{db.prepare('update users set balance=balance+? where id=?').run(bal,q.uid);db.prepare('update bank set dep=dep+?,loan=loan+? where uid=?').run(dep,loan,q.uid)};
  if(x==='deposit'){if(a>u.balance)throw Error('موجودی کافی نیست');up(-a,a,0)}
  else if(x==='withdraw'){if(a>b.dep)throw Error('سپرده کافی نیست');up(a,-a,0)}
  else if(x==='borrow'){const cap=wealth(q.uid)*.5;if(b.loan+a>cap)throw Error('سقف وام شما '+Math.max(0,Math.floor(cap-b.loan)).toLocaleString('fa-IR')+' تومان است');up(a,0,a)}
  else if(x==='repay'){const p=a>=Math.floor(b.loan)?b.loan:a;if(!(p>0))throw Error('وامی ندارید');if(p>u.balance)throw Error('موجودی کافی نیست');up(-p,0,-p)}
  else throw Error('عملیات نامعتبر')})();r.json(view(q.uid))}));
app.post('/api/transfer',auth,wrap((q,r)=>{const a=Math.floor(+q.body.amount),to=db.prepare('select id from users where username=?').get(q.body.to||'');
 if(!to||to.id===q.uid)throw Error('گیرنده نامعتبر است');if(!(a>0))throw Error('مبلغ نامعتبر است');
 db.transaction(()=>{if(db.prepare('select balance from users where id=?').get(q.uid).balance<a)throw Error('موجودی کافی نیست');
  db.prepare('update users set balance=balance-? where id=?').run(a,q.uid);db.prepare('update users set balance=balance+? where id=?').run(a,to.id)})();r.json(view(q.uid))}));
app.get('/api/top',auth,(q,r)=>{const us=db.prepare('select id,username,balance from users').all(),w={};us.forEach(u=>w[u.id]=u.balance);db.prepare('select uid,dep,loan from bank').all().forEach(b=>{if(w[b.uid]!==undefined)w[b.uid]+=b.dep-b.loan});
 db.prepare('select uid,sym,amt from holdings').all().forEach(h=>{if(w[h.uid]!==undefined)w[h.uid]+=h.amt*(mk[h.sym]?.price||0)});
 r.json(us.map(u=>({username:u.username,wealth:w[u.id]})).sort((a,b)=>b.wealth-a.wealth).slice(0,10))});
app.listen(process.env.PORT||3000,()=>console.log('up'));
