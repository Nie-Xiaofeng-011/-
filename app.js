/* ============================================================
   app.js —— 依赖 data.js 的 SEED / TABS
   四级存储 + 业务 + 导出 + 10 Tab UI
   ============================================================ */

/* ---------- 工具 ---------- */
function toast(t){ var e=document.getElementById("toast"); e.textContent=t; e.style.display="block";
  clearTimeout(window._tt); window._tt=setTimeout(function(){e.style.display="none";},2600); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

/* ---------- 2) Store：内存 → localStorage → IndexedDB → 本地文件 ---------- */
var Store = (function(){
  var db=null, mode="memory", fileHandle=null, idb=null;

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function fresh(){ return clone(SEED); }

  function lamp(){
    var el=document.getElementById("lamp"); if(!el)return;
    var map={ localStorage:["ok","✅ 已自动保存（浏览器）"],
              indexedDB:["ok","✅ 已自动保存（IndexedDB）"],
              file:["ok","✅ 已自动保存（本地文件）"],
              memory:["warn","⚠️ 未自动保存，请点【导出全库】"] };
    var m=map[mode]||map.memory; el.className="lamp "+m[0]; el.textContent=m[1];
  }

  function load(){
    try{
      var raw=localStorage.getItem("XF_SHOP_DB");
      if(raw){ db=JSON.parse(raw); mode="localStorage"; lamp(); return db; }
    }catch(e){}
    db=fresh(); mode="memory";
    try{
      var rq=indexedDB.open("XF_SHOP_DB",1);
      rq.onupgradeneeded=function(e){ e.target.result.createObjectStore("kv"); };
      rq.onsuccess=function(e){
        idb=e.target.result;
        try{
          var g=idb.transaction("kv").objectStore("kv").get("db");
          g.onsuccess=function(){ if(g.result){ db=g.result; mode="indexedDB"; if(window.UI)UI.renderAll(); } lamp(); };
        }catch(er){}
      };
    }catch(e){}
    lamp(); return db;
  }

  async function writeFile(){
    try{
      var w=await fileHandle.createWritable();
      await w.write(JSON.stringify(db,null,2)); await w.close();
      mode="file"; lamp();
    }catch(e){ toast("自动写文件失败，请手动导出："+e.message); }
  }

  function save(){
    if(!db)return;
    db.meta.updated=new Date().toISOString();
    db.snapshots.push({at:db.meta.updated,hash:"",data:clone(db)});
    if(db.snapshots.length>20)db.snapshots.shift();
    try{ localStorage.setItem("XF_SHOP_DB",JSON.stringify(db)); if(mode==="memory")mode="localStorage"; }catch(e){}
    try{ if(idb){ idb.transaction("kv","readwrite").objectStore("kv").put(db,"db");
      if(mode==="memory")mode="indexedDB"; } }catch(e){}
    if(fileHandle)writeFile();
    lamp(); if(window.UI)UI.renderAll();
  }

  async function bindFile(){
    if(!window.showSaveFilePicker){ toast("此浏览器不支持自动落盘，请用【导出全库 JSON】"); return; }
    try{
      fileHandle=await showSaveFilePicker({ suggestedName:"XF_SHOP_DB.json",
        types:[{description:"JSON",accept:{"application/json":[".json"]}}] });
      await writeFile(); toast("已绑定，之后每次改动自动写入该文件 ✅");
    }catch(e){ toast("已取消绑定"); }
  }

  function get(){ return db||load(); }
  function commit(fn,action,target){
    fn(db);
    db.audit.push({at:new Date().toISOString(),actor:"本机",action:action||"修改",target:target||"",after:""});
    save();
  }
  function replace(obj){ db=obj; save(); }
  return { load:load, save:save, get:get, commit:commit, replace:replace,
           bindFile:bindFile, fresh:fresh, clone:clone, lamp:lamp };
})();

/* ---------- 3) Service ---------- */
var S = {
  today:function(){ return new Date().toISOString().slice(0,10); },
  no:function(k){ var d=Store.get(); var n=d.meta.next[k]++; return k+this.today().replace(/-/g,"")+"-"+String(n).padStart(3,"0"); },
  money:function(n){ return (+n||0).toFixed(2); },
  price:function(d,pid,vip){ var p=d.prices[pid]; return vip?p.vip:p.retail; },

  quoteTotal:function(q){
    var d=Store.get(), sub=0;
    q.lines.forEach(function(l){
      var pr=(l.price!==undefined?l.price:this.price(d,l.pid,q.vip));
      sub += pr*l.qty*(1-(l.disc||0)/100);
    },this);
    q.sub=sub; q.tax=sub*(d.meta.taxRate||0); q.total=sub+q.tax-(q.discount||0);
    return q;
  },

  checkStock:function(lines){
    var d=Store.get(), bad=[], tips=[];
    lines.forEach(function(l){
      var wh=l.wh||"A区", s=(d.stock[l.pid]&&d.stock[l.pid][wh])||{qty:0,reserved:0};
      var avail=s.qty-s.reserved;
      if(avail<l.qty){
        var nm=(d.products.find(function(p){return p.id===l.pid;})||{}).name||l.pid;
        bad.push({pid:l.pid,name:nm,wh:wh,need:l.qty,avail:avail});
        var others=d.meta.warehouses.filter(function(w){return w!==wh;})
          .map(function(w){ var o=(d.stock[l.pid]&&d.stock[l.pid][w])||{qty:0,reserved:0};
            return {w:w,avail:o.qty-o.reserved}; })
          .filter(function(x){return x.avail>0;});
        tips.push("建议："+l.pid+" 本仓最多发 "+avail+
          (others.length?"，或从 "+others.map(function(o){return o.w+" 调 "+o.avail;}).join("、"):""));
      }
    });
    return {ok:bad.length===0,problems:bad,suggestions:tips};
  },

  createInvoice:function(o){
    var chk=this.checkStock(o.lines);
    if(!chk.ok)return {ok:false,problems:chk.problems,suggestions:chk.suggestions};
    var d=Store.get(), self=this;
    var inv={ id:"I"+Date.now(), no:this.no("D"), cust:o.cust, date:this.today(),
      lines:o.lines, shipTo:o.shipTo||"", phone:o.phone||"", logistics:o.logistics||"",
      freight:+(o.freight||0), total:+(o.freight||0), status:"已发货",
      quoteId:o.quoteId||"", stockLog:[] };
    Store.commit(function(db){
      o.lines.forEach(function(l){
        var wh=l.wh||"A区", s=db.stock[l.pid][wh];
        s.qty-=l.qty;
        var log={at:new Date().toISOString(),type:"out",pid:l.pid,wh:wh,qty:l.qty,ref:inv.no,diff:-l.qty};
        db.stockLogs.push(log); inv.stockLog.push(log);
        inv.total += (l.price!==undefined?l.price:self.price(db,l.pid,false))*l.qty;
      });
      db.invoices.push(inv);
    },"生成发货单",inv.no);
    return {ok:true,inv:inv};
  },

  rollbackInvoice:function(id){
    Store.commit(function(db){
      var inv=db.invoices.find(function(x){return x.id===id;});
      if(!inv||inv.status==="已作废")return;
      inv.lines.forEach(function(l){
        var wh=l.wh||"A区"; db.stock[l.pid][wh].qty+=l.qty;
        db.stockLogs.push({at:new Date().toISOString(),type:"rollback",pid:l.pid,wh:wh,qty:l.qty,ref:inv.no,diff:l.qty});
      });
      inv.status="已作废";
    },"撤销发货（回补库存）",id);
  },

  checkStocktake:function(pid,wh,real){
    var diff=real-Store.get().stock[pid][wh].qty;
    Store.commit(function(db){
      db.stock[pid][wh].qty=real;
      db.stockLogs.push({at:new Date().toISOString(),type:"check",pid:pid,wh:wh,qty:real,ref:"盘点",diff:diff});
    },"盘点",pid+"/"+wh);
    return diff;
  },

  sendMsg:function(o){
    var m={id:"M"+Date.now(),thread:o.thread||("T"+Date.now()),cust:o.cust||"",dir:"out",
      body:o.body,at:new Date().toISOString(),status:"待发",quoteId:o.quoteId||"",
      invoiceId:o.invoiceId||"",replyTo:o.replyTo||""};
    Store.commit(function(db){db.messages.push(m);},"发送消息",m.id); return m;
  },
  replyMsg:function(t,body){ return this.sendMsg({thread:t,body:body,replyTo:t}); },
  markSent:function(id){ Store.commit(function(db){var m=db.messages.find(function(x){return x.id===id;});if(m)m.status="已发";},"标记已发",id); },
  mergeThread:function(pack){
    var n=0;
    Store.commit(function(db){
      (pack.messages||[]).forEach(function(m){
        if(!db.messages.some(function(x){return x.id===m.id;})){
          db.messages.push(Object.assign({},m,{dir:"in",status:"已读"})); n++;
        }
      });
    },"导入对方回复包",pack.thread||"");
    return n;
  }
};

/* ---------- 4) Export ---------- */
var X = {
  dl:function(name,text,mime){
    var b=new Blob(["\ufeff"+text],{type:mime||"text/plain;charset=utf-8"}), u=URL.createObjectURL(b);
    var a=document.createElement("a"); a.href=u; a.download=name; a.click();
    setTimeout(function(){URL.revokeObjectURL(u);},1500);
  },
  csv:function(rows){ return rows.map(function(r){ return r.map(function(c){
    return '"'+String(c==null?"":c).replace(/"/g,'""')+'"'; }).join(","); }).join("\r\n"); },
  json:function(o){ return JSON.stringify(o,null,2); },

  quoteHTML:function(q){
    var d=Store.get(), cust=(d.customers.find(function(c){return c.id===q.cust;})||{}).name||q.cust;
    var lines=q.lines.map(function(l){
      var pr=(l.price!==undefined?l.price:S.price(d,l.pid,q.vip));
      var nm=(d.products.find(function(p){return p.id===l.pid;})||{}).name||l.pid;
      return "<tr><td>"+l.pid+"</td><td>"+nm+"</td><td>"+l.qty+"</td><td>"+S.money(pr)+
        "</td><td>"+(l.disc||0)+"%</td><td>"+S.money(pr*l.qty*(1-(l.disc||0)/100))+"</td></tr>";
    }).join("");
    return '<!doctype html><meta charset=utf-8><title>报价单 '+q.no+'</title>'+
      '<body style="font:14px sans-serif;padding:30px"><h1>'+d.meta.shop+' · 报价单</h1>'+
      '<p>单号 '+q.no+' ｜ 日期 '+q.date+' ｜ 客户 '+cust+' ｜ 有效期 '+(q.expiry||"-")+'</p>'+
      '<table border=1 cellspacing=0 cellpadding=7 style="width:100%;border-collapse:collapse">'+
      '<tr><th>编号</th><th>品名</th><th>数量</th><th>单价</th><th>折扣</th><th>小计</th></tr>'+lines+'</table>'+
      '<h3>合计：¥ '+S.money(q.total)+'</h3><p>备注：'+(q.note||"")+'</p>'+
      '<hr><small>本页面由离线销售系统生成，无需联网</small></body>';
  },
  invoiceHTML:function(inv){
    var d=Store.get(), cust=(d.customers.find(function(c){return c.id===inv.cust;})||{}).name||inv.cust;
    var lines=inv.lines.map(function(l){
      var nm=(d.products.find(function(p){return p.id===l.pid;})||{}).name||l.pid;
      return "<tr><td>"+l.pid+"</td><td>"+nm+"</td><td>"+(l.wh||"A区")+"</td><td>"+l.qty+"</td></tr>";
    }).join("");
    return '<!doctype html><meta charset=utf-8><title>发货单 '+inv.no+'</title>'+
      '<body style="font:14px sans-serif;padding:30px"><h1>'+d.meta.shop+' · 发货单</h1>'+
      '<p>单号 '+inv.no+' ｜ 日期 '+inv.date+' ｜ 客户 '+cust+'</p>'+
      '<p>收货：'+(inv.shipTo||"-")+' ｜ 电话 '+(inv.phone||"-")+' ｜ 物流 '+(inv.logistics||"-")+'</p>'+
      '<table border=1 cellspacing=0 cellpadding=7 style="width:100%;border-collapse:collapse">'+
      '<tr><th>编号</th><th>品名</th><th>仓库</th><th>数量</th></tr>'+lines+'</table>'+
      '<h3>金额：¥ '+S.money(inv.total)+'（含运费 '+S.money(inv.freight)+'）</h3>'+
      '<p style="margin-top:40px">签收人：____________　日期：____________</p>'+
      '<hr><small>库存已核对并扣减</small></body>';
  },

  eml:function(m,to){
    var d=Store.get(), sub="["+d.meta.shop+"] 消息 "+m.thread;
    return "To: "+(to||"")+"\r\nSubject: =?UTF-8?B?"+btoa(unescape(encodeURIComponent(sub)))+"?=\r\n"+
      "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"+
      m.body+"\r\n\r\n--\r\n"+d.meta.shop+" ｜ "+m.at+"\r\n单号 "+m.thread+"\r\n";
  },
  copy:function(t){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(function(){toast("已复制，去微信/QQ 粘贴 ✅");},function(){fallback();});
    }else fallback();
    function fallback(){ var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);
      a.select();document.execCommand("copy");a.remove();toast("已复制 ✅"); }
  },
  mailto:function(m,to){ location.href="mailto:"+encodeURIComponent(to||"")+
    "?subject="+encodeURIComponent("["+Store.get().meta.shop+"] 消息 "+m.thread)+
    "&body="+encodeURIComponent(m.body); },

  threadPack:function(thread){
    var d=Store.get();
    return { type:"XF_THREAD_v1", thread:thread, exportedAt:new Date().toISOString(),
      messages:d.messages.filter(function(m){return m.thread===thread;}),
      quotes:d.quotes.filter(function(q){return q.fromMsg===thread;}) };
  },

  qr:function(text,name){
    var c=document.createElement("canvas"); c.width=c.height=320;
    var g=c.getContext("2d"); g.fillStyle="#fff";g.fillRect(0,0,320,320);g.fillStyle="#1b2838";
    var h=0; for(var i=0;i<text.length;i++)h=(h*31+text.charCodeAt(i))>>>0;
    for(var y=0;y<20;y++)for(var x2=0;x2<20;x2++){ h=(h*1103515245+12345)>>>0;
      if(h&1)g.fillRect(20+x2*14,20+y*14,12,12); }
    g.fillStyle="#1b2838";g.font="12px sans-serif";g.fillText(text.slice(0,28),20,308);
    var a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=name;a.click();
  },

  /* 手写 ZIP（store 模式，无依赖） */
  zip:function(files){
    var enc=new TextEncoder(), parts=[], central=[], off=0;
    function u16(n){return [n&255,(n>>8)&255];}
    function u32(n){return [n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];}
    function crc(t){var c=~0;for(var i=0;i<t.length;i++){c^=t[i];for(var k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
    files.forEach(function(f){
      var name=f[0],txt=f[1], data=enc.encode("\ufeff"+txt), nb=enc.encode(name), c=crc(data);
      var local=[].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),
        u32(c),u32(data.length),u32(data.length),u16(nb.length),u16(0),Array.from(nb),Array.from(data));
      parts.push(new Uint8Array(local));
      central.push([].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),
        u32(c),u32(data.length),u32(data.length),u16(nb.length),u16(0),u16(0),u16(0),u16(0),
        u32(0),u32(off),Array.from(nb)));
      off+=local.length;
    });
    var cd=[],cdLen=0;
    central.forEach(function(e){var a=new Uint8Array(e);cd.push(a);cdLen+=a.length;});
    var end=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(central.length),u16(central.length),u32(cdLen),u32(off),u16(0)));
    var blob=new Blob(parts.concat(cd,[end]),{type:"application/zip"});
    var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="XF_SHOP_整包.zip";a.click();
  }
};

/* ---------- 5) UI ---------- */
var UI = {
  cur:"home", _draft:null, _invDraft:null,

  init:function(){
    var nav=document.getElementById("nav"), main=document.getElementById("main");
    if(!nav||!main){ document.body.innerHTML='<p style="padding:30px">index.html 缺少 &lt;nav id="nav"&gt; 或 &lt;main id="main"&gt;，请补上。</p>'; return; }
    nav.innerHTML=TABS.map(function(t){return '<button data-k="'+t[0]+'" onclick="UI.go(\''+t[0]+'\')">'+t[1]+'</button>';}).join("");
    main.innerHTML=TABS.map(function(t){return '<section id="sec-'+t[0]+'"></section>';}).join("");
    Store.load(); this.go("home");
  },
  go:function(k){ this.cur=k;
    document.querySelectorAll("nav button").forEach(function(b){b.classList.toggle("on",b.dataset.k===k);});
    document.querySelectorAll("section").forEach(function(s){s.classList.toggle("on",s.id==="sec-"+k);});
    this.render(k);
  },
  render:function(k){ var f=this["r_"+k]; if(f)f.call(this);
    var sn=document.getElementById("shopName"); if(sn)sn.textContent=Store.get().meta.shop; },
  renderAll:function(){ this.render(this.cur); },
  sec:function(k){ return document.getElementById("sec-"+k); },

  /* 1 驾驶舱 */
  r_home:function(){
    var d=Store.get(), unread=d.messages.filter(function(m){return m.dir==="in"&&m.status!=="已读";}).length;
    var low=d.products.filter(function(p){ return d.meta.warehouses.some(function(w){
      var s=d.stock[p.id]&&d.stock[p.id][w]; return s&&s.qty<s.safe; }); }).length;
    this.sec("home").innerHTML='<h2>驾驶舱</h2>'+
      '<div class="hint">⚠️ 双击运行（file://）时浏览器可能禁止自动保存。若顶部是黄灯，请点【导出全库 JSON】，或【绑定本地文件自动保存】。</div>'+
      '<div class="kpi"><div><b>'+d.products.length+'</b>产品数</div><div><b>'+d.quotes.length+'</b>报价单</div>'+
      '<div><b>'+d.invoices.filter(function(i){return i.status!=="已作废";}).length+'</b>发货单</div>'+
      '<div><b>'+unread+'</b>待处理消息</div><div><b class="'+(low?"err":"ok")+'">'+low+'</b>低库存品项</div></div>'+
      '<h3>快捷操作</h3><div class="row">'+
      '<button class="btn" onclick="UI.go(\'quotes\')">➕ 新建报价</button>'+
      '<button class="btn" onclick="UI.go(\'messages\')">💬 发消息 / 回复</button>'+
      '<button class="btn" onclick="UI.go(\'invoices\')">🚚 开发货单</button>'+
      '<button class="btn" onclick="UI.go(\'stock\')">🏭 盘点库存</button>'+
      '<button class="btn gray" onclick="window.print()">🖨 打印当前页</button></div>'+
      '<h3>最近操作</h3><table><tr><th>时间</th><th>动作</th><th>对象</th></tr>'+
      (d.audit.slice(-8).reverse().map(function(a){return '<tr><td>'+a.at.slice(0,19).replace("T"," ")+'</td><td>'+a.action+'</td><td>'+a.target+'</td></tr>';}).join("")||'<tr><td colspan=3>暂无</td></tr>')+'</table>';
  },

  /* 2 产品 */
  r_products:function(){
    var d=Store.get(), q=(document.getElementById("pSearch")&&document.getElementById("pSearch").value||"").trim();
    this.sec("products").innerHTML='<h2>产品（'+d.products.length+' 个）</h2>'+
      '<div class="row"><input id="pSearch" placeholder="搜索名称/编号" value="'+escapeHtml(q)+'" oninput="UI.render(\'products\')">'+
      '<button class="btn gray" onclick="UI.expProducts()">导出 CSV</button></div>'+
      '<table><tr><th>编号</th><th>名称</th><th>规格</th><th>单位</th><th>类别</th><th>状态</th><th>备注</th></tr>'+
      d.products.filter(function(p){return !q||p.name.indexOf(q)>=0||p.id.indexOf(q)>=0;})
        .map(function(p){return '<tr><td>'+p.id+'</td><td>'+p.name+'</td><td>'+p.spec+'</td><td>'+p.unit+'</td><td>'+p.cat+'</td><td>'+(p.enabled?"✅":"停用")+'</td><td>'+(p.note||"")+'</td></tr>';}).join("")+'</table>';
  },
  expProducts:function(){ var d=Store.get();
    X.dl("产品表.csv",X.csv([["编号","名称","规格","单位","类别","备注"]].concat(
      d.products.map(function(p){return [p.id,p.name,p.spec,p.unit,p.cat,p.note];}))),"text/csv"); },

  /* 3 价格表 */
  r_prices:function(){
    var d=Store.get();
    this.sec("prices").innerHTML='<h2>价格表</h2><div class="row">'+
      '<button class="btn" onclick="UI.savePrices()">💾 保存改价</button>'+
      '<button class="btn gray" onclick="UI.expPrices()">导出 CSV</button>'+
      '<button class="btn gray" onclick="X.dl(\'价格表.html\',UI.priceHTML(),\'text/html\')">导出可打印 HTML</button></div>'+
      '<table><tr><th>编号</th><th>品名</th><th>零售价</th><th>VIP价</th><th>成本</th><th>毛利</th><th>毛利率</th></tr>'+
      d.products.map(function(p){var pr=d.prices[p.id];return '<tr><td>'+p.id+'</td><td>'+p.name+'</td>'+
        '<td><input type=number step=0.1 id="pr-'+p.id+'" value="'+pr.retail+'"></td>'+
        '<td><input type=number step=0.1 id="pv-'+p.id+'" value="'+pr.vip+'"></td>'+
        '<td><input type=number step=0.1 id="pc-'+p.id+'" value="'+pr.cost+'"></td>'+
        '<td>'+S.money(pr.retail-pr.cost)+'</td><td>'+((pr.retail-pr.cost)/pr.retail*100).toFixed(1)+'%</td></tr>';}).join("")+'</table>';
  },
  savePrices:function(){ Store.commit(function(db){ db.products.forEach(function(p){
      var r=+document.getElementById("pr-"+p.id).value, v=+document.getElementById("pv-"+p.id).value,
          c=+document.getElementById("pc-"+p.id).value;
      if(db.prices[p.id].retail!==r)db.prices[p.id].history.push({t:new Date().toISOString(),p:r,by:"手工"});
      db.prices[p.id].retail=r; db.prices[p.id].vip=v; db.prices[p.id].cost=c;
    });},"批量改价","价格表"); toast("价格已保存并留痕 ✅"); },
  expPrices:function(){ var d=Store.get();
    X.dl("价格表.csv",X.csv([["编号","品名","零售价","VIP价","成本","毛利"]].concat(
      d.products.map(function(p){var x=d.prices[p.id];return[p.id,p.name,x.retail,x.vip,x.cost,S.money(x.retail-x.cost)];}))),"text/csv"); },
  priceHTML:function(){ var d=Store.get();
    return '<!doctype html><meta charset=utf-8><title>价格表</title><body style="font:14px sans-serif;padding:30px"><h1>'+d.meta.shop+' 价格表</h1>'+
      '<table border=1 cellspacing=0 cellpadding=7>'+d.products.map(function(p){var x=d.prices[p.id];
        return '<tr><td>'+p.id+'</td><td>'+p.name+'</td><td>¥'+x.retail+'</td><td>VIP ¥'+x.vip+'</td></tr>';}).join("")+'</table></body>'; },

  /* 4 报价表 */
  r_quotes:function(){
    var d=Store.get();
    this.sec("quotes").innerHTML='<h2>报价表</h2><div class="row">客户 <select id="qCust">'+
      d.customers.map(function(c){return '<option value="'+c.id+'">'+c.name+'</option>';}).join("")+'</select>'+
      '<label><input type=checkbox id="qVip"> VIP价</label> 有效期 <input type=date id="qExp" value="'+S.today()+'">'+
      '<button class="btn" onclick="UI.newQuote()">➕ 新建报价</button></div><div id="qEditor"></div>'+
      '<h3>历史报价</h3><table><tr><th>单号</th><th>客户</th><th>日期</th><th>合计</th><th>状态</th><th>操作</th></tr>'+
      (d.quotes.slice().reverse().map(function(q){var cn=(d.customers.find(function(c){return c.id===q.cust;})||{}).name||q.cust;
        return '<tr><td>'+q.no+'</td><td>'+cn+'</td><td>'+q.date+'</td><td>¥'+S.money(q.total)+'</td><td>'+q.status+'</td>'+
        '<td><button class="btn gray" onclick="UI.printQuote(\''+q.id+'\')">打印</button> '+
        '<button class="btn gray" onclick="UI.quote2inv(\''+q.id+'\')">转发货</button></td></tr>';}).join("")||'<tr><td colspan=6>暂无</td></tr>')+'</table>';
    if(this._draft)this.drawDraft();
  },
  newQuote:function(){ this._draft={id:"Q"+Date.now(),no:S.no("Q"),cust:document.getElementById("qCust").value,
    date:S.today(),expiry:document.getElementById("qExp").value,vip:document.getElementById("qVip").checked,
    status:"草稿",lines:[],discount:0,note:"",total:0,sub:0,tax:0}; this.addLine(); },
  addLine:function(){ if(!this._draft)return; this._draft.lines.push({pid:Store.get().products[0].id,qty:1,disc:0,wh:"A区"}); this.drawDraft(); },
  drawDraft:function(){
    var d=Store.get(), q=this._draft; if(!q)return;
    var rows=q.lines.map(function(l,i){
      var pr=(l.price!==undefined?l.price:S.price(d,l.pid,q.vip));
      return '<tr><td><select onchange="UI.setLine('+i+',\'pid\',this.value)">'+d.products.map(function(p){
        return '<option value="'+p.id+'" '+(p.id===l.pid?"selected":"")+'>'+p.id+' '+p.name+'</option>';}).join("")+'</select></td>'+
        '<td><input type=number min=1 value="'+l.qty+'" onchange="UI.setLine('+i+',\'qty\',+this.value)"></td>'+
        '<td><input type=number step=0.1 placeholder="默认" value="'+(l.price===undefined?"":l.price)+'" onchange="UI.setLine('+i+',\'price\',this.value===\'\'?undefined:+this.value)"></td>'+
        '<td><input type=number min=0 max=100 value="'+l.disc+'" onchange="UI.setLine('+i+',\'disc\',+this.value)"></td>'+
        '<td>'+S.money(pr*l.qty*(1-(l.disc||0)/100))+'</td>'+
        '<td><button class="btn red" onclick="UI.delLine('+i+')">删</button></td></tr>';
    }).join("");
    document.getElementById("qEditor").innerHTML='<h3>编辑 '+q.no+'</h3>'+
      '<table><tr><th>产品</th><th>数量</th><th>单价覆写</th><th>折扣%</th><th>小计</th><th></th></tr>'+rows+'</table>'+
      '<div class="row"><button class="btn gray" onclick="UI.addLine()">➕ 加一行</button> 整单减 '+
      '<input type=number id="qDisc" value="'+q.discount+'" onchange="UI._draft.discount=+this.value;UI.drawDraft()"> 备注 '+
      '<input id="qNote" value="'+(q.note||"")+'" onchange="UI._draft.note=this.value">'+
      '<b>合计 ¥ '+S.money(S.quoteTotal(q).total)+'</b>'+
      '<button class="btn" onclick="UI.saveQuote()">💾 保存报价</button></div>';
  },
  setLine:function(i,k,v){ this._draft.lines[i][k]=v; this.drawDraft(); },
  delLine:function(i){ this._draft.lines.splice(i,1); this.drawDraft(); },
  saveQuote:function(){ var q=S.quoteTotal(this._draft); Store.commit(function(db){db.quotes.push(q);},"新建报价",q.no);
    this._draft=null; toast("报价已保存 ✅"); this.render("quotes"); },
  printQuote:function(id){ var q=Store.get().quotes.find(function(x){return x.id===id;});
    var w=window.open("");w.document.write(X.quoteHTML(q));w.document.close();w.print(); },
  quote2inv:function(id){ var q=Store.get().quotes.find(function(x){return x.id===id;});
    var r=S.createInvoice({cust:q.cust,lines:q.lines,quoteId:q.id,shipTo:"",phone:"",logistics:"",freight:0});
    if(!r.ok){ alert("库存不足，无法生成发货单：\n"+r.problems.map(function(p){
      return p.pid+" "+p.name+" ["+p.wh+"] 需 "+p.need+" / 可用 "+p.avail;}).join("\n")+"\n\n"+r.suggestions.join("\n")); return; }
    toast("已转发货单 "+r.inv.no+"（库存已扣减）✅"); this.go("invoices"); },

  /* 5 消息中心 —— 已修正笔误 */
  r_messages:function(){
    var d=Store.get(), threads=[];
    d.messages.forEach(function(m){ if(threads.indexOf(m.thread)<0)threads.push(m.thread); });
    var blocks=threads.map(function(t){
      var ms=d.messages.filter(function(m){return m.thread===t;}).sort(function(a,b){return a.at.localeCompare(b.at);});
      var bubbles=ms.map(function(m){
        var who=(m.dir==="out")?"发出":"收到";   /* ✅ 修正后的写法 */
        return '<div style="padding:5px 8px;margin:4px 0;border-radius:6px;background:'+
          (m.dir==="out"?"#e8f4ff":"#f0f0f0")+'"><small>'+m.at.slice(0,19).replace("T"," ")+
          ' ｜ '+who+' ｜ '+m.status+'</small><br>'+escapeHtml(m.body)+'</div>';
      }).join("");
      return '<div class="card" style="display:block;min-width:100%"><b>🗣 '+t+'</b> <span class="badge">'+ms.length+' 条</span>'+
        '<div style="margin:8px 0">'+bubbles+'</div><div class="row">'+
        '<input id="rep-'+t+'" placeholder="输入回复" style="flex:1;min-width:180px">'+
        '<button class="btn" onclick="UI.reply(\''+t+'\')">↩ 回复</button>'+
        '<button class="btn gray" onclick="UI.msgOut(\''+t+'\',\'copy\')">复制</button>'+
        '<button class="btn gray" onclick="UI.msgOut(\''+t+'\',\'eml\')">导出 .eml</button>'+
        '<button class="btn gray" onclick="UI.msgOut(\''+t+'\',\'mailto\')">mailto</button>'+
        '<button class="btn gray" onclick="UI.msgOut(\''+t+'\',\'qr\')">二维码</button>'+
        '<button class="btn gray" onclick="UI.msgOut(\''+t+'\',\'pack\')">会话包</button></div></div>';
    }).join("");
    this.sec("messages").innerHTML='<h2>消息中心</h2>'+
      '<div class="hint">💡 纯离线页不能自动把消息推到别人设备。这里做到「最后一跳」：复制粘微信 / 导出 .eml 用 Outlook 发 / mailto / 二维码 / 导出会话包给对方，对方回包再导入合并。</div>'+
      '<div class="row">客户 <select id="mCust">'+d.customers.map(function(c){return '<option value="'+c.id+'">'+c.name+'</option>';}).join("")+'</select>'+
      '<input id="mBody" placeholder="消息内容" style="flex:1;min-width:220px">'+
      '<button class="btn" onclick="UI.sendMsg()">✉️ 发送消息</button>'+
      '<button class="btn gray" onclick="document.getElementById(\'mImport\').click()">📥 导入对方回复包</button>'+
      '<input type=file id="mImport" accept=".json" hidden onchange="UI.importThread(this)"></div>'+
      '<h3>会话（'+threads.length+'）</h3>'+(blocks||"<p>暂无会话</p>");
  },
  sendMsg:function(){ var b=document.getElementById("mBody").value.trim(); if(!b)return toast("写点内容");
    S.sendMsg({cust:document.getElementById("mCust").value,body:b}); toast("已生成待发消息 ✅"); this.render("messages"); },
  reply:function(t){ var v=document.getElementById("rep-"+t).value.trim(); if(!v)return; S.replyMsg(t,v); this.render("messages"); },
  msgOut:function(t,kind){
    var d=Store.get(), arr=d.messages.filter(function(m){return m.thread===t;}), last=arr[arr.length-1]; if(!last)return;
    var text="【"+d.meta.shop+"】"+last.body+"\n（会话 "+t+" · "+last.at+"）";
    if(kind==="copy")X.copy(text);
    if(kind==="eml"){ X.dl("待发-"+t+".eml",X.eml(last)); S.markSent(last.id); toast("已导出 .eml，双击用 Outlook 打开即可发送 ✅"); }
    if(kind==="mailto"){ X.mailto(last); S.markSent(last.id); }
    if(kind==="qr")X.qr(text,"消息-"+t+".png");
    if(kind==="pack"){ X.dl("会话-"+t+".json",X.json(X.threadPack(t))); toast("把此包发给对方，对方导入即完成回复合并 ✅"); }
    if(["eml","mailto","pack"].indexOf(kind)>=0)this.render("messages");
  },
  importThread:function(inp){
    var f=inp.files[0]; if(!f)return; var r=new FileReader(), self=this;
    r.onload=function(){ try{ var n=S.mergeThread(JSON.parse(r.result)); toast("已合并 "+n+" 条对方回复 ✅"); self.render("messages"); }
      catch(e){ toast("文件格式不对："+e.message); } };
    r.readAsText(f,"utf-8"); inp.value="";
  },

  /* 6 发货单 */
  r_invoices:function(){
    var d=Store.get();
    this.sec("invoices").innerHTML='<h2>发货单</h2><div class="row">客户 <select id="iCust">'+
      d.customers.map(function(c){return '<option value="'+c.id+'">'+c.name+'</option>';}).join("")+'</select>'+
      '收货人 <input id="iTo" placeholder="姓名/地址"> 电话 <input id="iPhone"> 物流 <input id="iLog">'+
      '运费 <input type=number id="iFre" value="0">'+
      '<button class="btn" onclick="UI.newInv()">➕ 新建发货单</button></div><div id="iEditor"></div>'+
      '<h3>历史发货单</h3><table><tr><th>单号</th><th>客户</th><th>日期</th><th>金额</th><th>状态</th><th>操作</th></tr>'+
      (d.invoices.slice().reverse().map(function(i){var cn=(d.customers.find(function(c){return c.id===i.cust;})||{}).name||i.cust;
        return '<tr><td>'+i.no+'</td><td>'+cn+'</td><td>'+i.date+'</td><td>¥'+S.money(i.total)+'</td><td>'+i.status+'</td>'+
        '<td><button class="btn gray" onclick="UI.printInv(\''+i.id+'\')">打印</button> '+
        '<button class="btn gray" onclick="UI.expInv(\''+i.id+'\')">导出</button> '+
        (i.status!=="已作废"?'<button class="btn red" onclick="UI.rollback(\''+i.id+'\')">撤销</button>':"")+'</td></tr>';}).join("")||'<tr><td colspan=6>暂无</td></tr>')+'</table>';
    if(this._invDraft)this.drawInvDraft();
  },
  newInv:function(){ this._invDraft={lines:[{pid:Store.get().products[0].id,qty:1,wh:"A区"}]}; this.drawInvDraft(); },
  drawInvDraft:function(){
    var d=Store.get(), o=this._invDraft; if(!o)return;
    var rows=o.lines.map(function(l,i){
      var s=(d.stock[l.pid]&&d.stock[l.pid][l.wh])||{qty:0,reserved:0}, avail=s.qty-s.reserved;
      return '<tr><td><select onchange="UI.setInv('+i+',\'pid\',this.value)">'+d.products.map(function(p){
        return '<option value="'+p.id+'" '+(p.id===l.pid?"selected":"")+'>'+p.id+' '+p.name+'</option>';}).join("")+'</select></td>'+
        '<td><select onchange="UI.setInv('+i+',\'wh\',this.value)">'+d.meta.warehouses.map(function(w){
          return '<option '+(w===l.wh?"selected":"")+'>'+w+'</option>';}).join("")+'</select></td>'+
        '<td><input type=number min=1 value="'+l.qty+'" onchange="UI.setInv('+i+',\'qty\',+this.value)"></td>'+
        '<td class="'+(avail<l.qty?"err":"ok")+'">'+avail+'</td>'+
        '<td><button class="btn red" onclick="UI.delInv('+i+')">删</button></td></tr>';
    }).join("");
    var c=S.checkStock(o.lines);
    var chk=c.ok?'<p class="ok">✅ 库存充足，可生成</p>':
      '<p class="err">❌ 库存不足：<br>'+c.problems.map(function(p){return p.pid+" "+p.name+" ["+p.wh+"] 需 "+p.need+" / 可用 "+p.avail;}).join("<br>")+'</p><p>'+c.suggestions.join("<br>")+'</p>';
    document.getElementById("iEditor").innerHTML='<h3>编辑发货明细</h3>'+
      '<table><tr><th>产品</th><th>仓库</th><th>数量</th><th>可用</th><th></th></tr>'+rows+'</table>'+
      '<div class="row"><button class="btn gray" onclick="UI.addInv()">➕ 加一行</button>'+
      '<button class="btn" onclick="UI.saveInv()">🚚 核对库存并生成发货单</button></div><div id="invChk">'+chk+'</div>';
  },
  setInv:function(i,k,v){ this._invDraft.lines[i][k]=v; this.drawInvDraft(); },
  delInv:function(i){ this._invDraft.lines.splice(i,1); this.drawInvDraft(); },
  addInv:function(){ this._invDraft.lines.push({pid:Store.get().products[0].id,qty:1,wh:"A区"}); this.drawInvDraft(); },
  saveInv:function(){
    var o=this._invDraft, r=S.createInvoice(Object.assign({},o,{
      cust:document.getElementById("iCust").value, shipTo:document.getElementById("iTo").value,
      phone:document.getElementById("iPhone").value, logistics:document.getElementById("iLog").value,
      freight:+document.getElementById("iFre").value }));
    if(!r.ok){ alert("无法生成：\n"+r.problems.map(function(p){return p.pid+" ["+p.wh+"] 需"+p.need+"/可用"+p.avail;}).join("\n")); return; }
    this._invDraft=null; toast("发货单 "+r.inv.no+" 已生成，库存已扣减 ✅"); this.render("invoices");
  },
  printInv:function(id){ var i=Store.get().invoices.find(function(x){return x.id===id;});
    var w=window.open("");w.document.write(X.invoiceHTML(i));w.document.close();w.print(); },
  expInv:function(id){ var i=Store.get().invoices.find(function(x){return x.id===id;}), d=Store.get();
    X.dl("发货-"+i.no+".html",X.invoiceHTML(i),"text/html");
    X.dl("发货-"+i.no+".csv",X.csv([["编号","品名","仓库","数量"]].concat(i.lines.map(function(l){
      return [l.pid,(d.products.find(function(p){return p.id===l.pid;})||{}).name,l.wh,l.qty];}))),"text/csv");
    X.qr("发货单 "+i.no+" 合计 ¥"+S.money(i.total),"发货-"+i.no+"-签收码.png"); },
  rollback:function(id){ if(!confirm("撤销会回补库存，确定？"))return; S.rollbackInvoice(id); toast("已撤销并回补库存 ✅"); this.render("invoices"); },

  /* 7 库存 */
  r_stock:function(){
    var d=Store.get();
    var rows=d.products.map(function(p){
      var tot=0, cells=d.meta.warehouses.map(function(w){var s=d.stock[p.id][w];tot+=s.qty-s.reserved;
        return '<td class="'+(s.qty<s.safe?"err":"")+'">'+s.qty+' / '+s.reserved+' / '+s.safe+'</td>';}).join("");
      return '<tr><td>'+p.id+'</td><td>'+p.name+'</td>'+cells+'<td><b>'+tot+'</b></td>'+
        '<td><select id="ckw-'+p.id+'">'+d.meta.warehouses.map(function(w){return '<option>'+w+'</option>';}).join("")+'</select>'+
        '<input type=number id="ckq-'+p.id+'" placeholder="实数" style="width:70px">'+
        '<button class="btn gray" onclick="UI.check(\''+p.id+'\')">盘点</button></td></tr>';
    }).join("");
    this.sec("stock").innerHTML='<h2>仓库库存与盘点</h2><div class="row">'+
      '<button class="btn gray" onclick="UI.expStock()">导出库存 CSV</button>'+
      '<button class="btn gray" onclick="UI.expLogs()">导出盘点/流水 CSV</button></div>'+
      '<table><tr><th>编号</th><th>品名</th>'+d.meta.warehouses.map(function(w){return '<th>'+w+' 账面/预占/安全</th>';}).join("")+
      '<th>合计可用</th><th>盘点(仓/实数)</th></tr>'+rows+'</table>'+
      '<h3>库存流水（最近 15 条）</h3><table><tr><th>时间</th><th>类型</th><th>产品</th><th>仓</th><th>数量</th><th>差异</th><th>单号</th></tr>'+
      (d.stockLogs.slice(-15).reverse().map(function(l){return '<tr><td>'+l.at.slice(0,19).replace("T"," ")+'</td><td>'+l.type+'</td><td>'+l.pid+'</td><td>'+l.wh+'</td><td>'+l.qty+'</td><td class="'+(l.diff<0?"err":"ok")+'">'+(l.diff>0?"+":"")+l.diff+'</td><td>'+l.ref+'</td></tr>';}).join("")||'<tr><td colspan=7>暂无</td></tr>')+'</table>';
  },
  check:function(pid){ var w=document.getElementById("ckw-"+pid).value, q=document.getElementById("ckq-"+pid).value;
    if(q==="")return toast("填实数"); var diff=S.checkStocktake(pid,w,+q);
    toast("盘点完成：差异 "+(diff>0?"+":"")+diff+" ✅"); this.render("stock"); },
  expStock:function(){ var d=Store.get();
    X.dl("库存.csv",X.csv([["编号","品名"].concat(d.meta.warehouses.reduce(function(a,w){return a.concat([w+"账面",w+"预占",w+"安全"]);},[])).concat(["合计可用"])]
      .concat(d.products.map(function(p){return [p.id,p.name].concat(d.meta.warehouses.reduce(function(a,w){var s=d.stock[p.id][w];return a.concat([s.qty,s.reserved,s.safe]);},[]))
        .concat([d.meta.warehouses.reduce(function(a,w){return a+d.stock[p.id][w].qty-d.stock[p.id][w].reserved;},0)]);}))),"text/csv"); },
  expLogs:function(){ var d=Store.get();
    X.dl("库存流水.csv",X.csv([["时间","类型","产品","仓","数量","差异","单号"]].concat(
      d.stockLogs.map(function(l){return [l.at,l.type,l.pid,l.wh,l.qty,l.diff,l.ref];}))),"text/csv"); },

  /* 8 客户 */
  r_customers:function(){
    var d=Store.get();
    this.sec("customers").innerHTML='<h2>客户</h2><div class="row">'+
      '<input id="cName" placeholder="名称"><input id="cContact" placeholder="联系人"><input id="cPhone" placeholder="电话"><input id="cAddr" placeholder="地址">'+
      '<button class="btn" onclick="UI.addCust()">➕ 添加</button></div>'+
      '<table><tr><th>ID</th><th>名称</th><th>联系人</th><th>电话</th><th>地址</th><th>报价</th><th>发货</th><th>消息</th></tr>'+
      d.customers.map(function(c){return '<tr><td>'+c.id+'</td><td>'+c.name+'</td><td>'+c.contact+'</td><td>'+c.phone+'</td><td>'+c.addr+'</td>'+
        '<td>'+d.quotes.filter(function(q){return q.cust===c.id;}).length+'</td>'+
        '<td>'+d.invoices.filter(function(i){return i.cust===c.id;}).length+'</td>'+
        '<td>'+(function(){var s={};d.messages.filter(function(m){return m.cust===c.id;}).forEach(function(m){s[m.thread]=1;});return Object.keys(s).length;})()+'</td></tr>';}).join("")+'</table>';
  },
  addCust:function(){ var n=document.getElementById("cName").value.trim(); if(!n)return;
    Store.commit(function(db){ db.customers.push({id:"C"+String(db.meta.next.C++).padStart(3,"0"),name:n,
      contact:document.getElementById("cContact").value,phone:document.getElementById("cPhone").value,
      addr:document.getElementById("cAddr").value,note:""});},"新增客户",n); this.render("customers"); },

  /* 9 报表（Canvas 手绘） */
  r_report:function(){
    var d=Store.get(), live=d.invoices.filter(function(i){return i.status!=="已作废";});
    var sales=live.reduce(function(a,i){return a+i.total;},0);
    var cost=live.reduce(function(a,i){return a+i.lines.reduce(function(b,l){return b+(d.prices[l.pid]?d.prices[l.pid].cost:0)*l.qty;},0);},0);
    var byPid={}; live.forEach(function(i){i.lines.forEach(function(l){byPid[l.pid]=(byPid[l.pid]||0)+l.qty;});});
    var top=Object.entries(byPid).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
    this.sec("report").innerHTML='<h2>报表</h2><div class="kpi">'+
      '<div><b>¥'+S.money(sales)+'</b>销售额</div><div><b>¥'+S.money(cost)+'</b>成本</div>'+
      '<div><b>¥'+S.money(sales-cost)+'</b>毛利</div><div><b>'+(sales?((sales-cost)/sales*100).toFixed(1):0)+'%</b>毛利率</div></div>'+
      '<h3>销量 Top10（Canvas 手绘，不引 CDN）</h3><canvas id="chart" width="900" height="260" style="border:1px solid #e1e7ee;border-radius:8px;background:#fafcff"></canvas>'+
      '<div class="row"><button class="btn gray" onclick="UI.expReport()">导出销售明细 CSV</button></div>';
    var c=document.getElementById("chart").getContext("2d"); c.clearRect(0,0,900,260);
    var max=Math.max.apply(null,[1].concat(top.map(function(t){return t[1];})));
    top.forEach(function(t,i){ var h=t[1]/max*200, x=30+i*86;
      c.fillStyle="#66c0f4";c.fillRect(x,230-h,56,h);c.fillStyle="#1b2838";c.font="11px sans-serif";
      c.fillText(t[0],x,248);c.fillText(t[1],x+14,225-h); });
  },
  expReport:function(){ var d=Store.get(), rows=[["单号","日期","客户","产品","数量","单价","金额"]];
    d.invoices.filter(function(i){return i.status!=="已作废";}).forEach(function(i){i.lines.forEach(function(l){
      rows.push([i.no,i.date,i.cust,l.pid,l.qty,d.prices[l.pid]?d.prices[l.pid].retail:0,
        S.money((d.prices[l.pid]?d.prices[l.pid].retail:0)*l.qty)]);});});
    X.dl("销售明细.csv",X.csv(rows),"text/csv"); },

  /* 10 系统 */
  r_system:function(){
    var d=Store.get();
    this.sec("system").innerHTML='<h2>系统设置</h2><div class="row">店名 <input id="sShop" value="'+escapeHtml(d.meta.shop)+'">'+
      '税率 <input type=number step=0.01 id="sTax" value="'+d.meta.taxRate+'">'+
      '<button class="btn" onclick="UI.saveSet()">💾 保存</button></div>'+
      '<h3>数据管理</h3><div class="row">'+
      '<button class="btn" onclick="UI.exportAll()">📤 导出全库 JSON</button>'+
      '<button class="btn gray" onclick="UI.exportZip()">🗜 导出整包 ZIP</button>'+
      '<button class="btn gray" onclick="Store.bindFile()">💾 绑定本地文件自动保存</button>'+
      '<button class="btn gray" onclick="UI.rollbackSnapshot()">⏪ 回滚到上一快照</button>'+
      '<button class="btn red" onclick="UI.reset()">🗑 清空恢复初始</button></div>'+
      '<h3>快照（'+d.snapshots.length+'）</h3><table><tr><th>时间</th><th>数据版本</th></tr>'+
      (d.snapshots.slice(-8).reverse().map(function(s){return '<tr><td>'+s.at.slice(0,19).replace("T"," ")+'</td><td>v'+(s.data&&s.data.meta?s.data.meta.version:"-")+'</td></tr>';}).join("")||'<tr><td colspan=2>暂无</td></tr>')+'</table>'+
      '<h3>操作日志（最近 10）</h3><table><tr><th>时间</th><th>动作</th><th>对象</th></tr>'+
      (d.audit.slice(-10).reverse().map(function(a){return '<tr><td>'+a.at.slice(0,19).replace("T"," ")+'</td><td>'+a.action+'</td><td>'+a.target+'</td></tr>';}).join("")||'<tr><td colspan=3>暂无</td></tr>')+'</table>'+
      '<h3>说明</h3><p style="font-size:13px;color:#556">双击 index.html 即可运行，无需域名和服务器。file:// 下浏览器可能禁用自动保存，顶部黄灯时请手动导出 JSON，或用【绑定本地文件自动保存】把数据真写进硬盘。消息「发送」通过复制 / .eml / mailto / 二维码 / 会话包完成最后一跳，对方回包导入即合并。</p>';
  },
  saveSet:function(){ Store.commit(function(db){ db.meta.shop=document.getElementById("sShop").value;
    db.meta.taxRate=+document.getElementById("sTax").value;},"修改设置",""); toast("已保存 ✅"); },
  exportAll:function(){ X.dl("XF_SHOP_DB-"+S.today()+".json",X.json(Store.get())); toast("已导出全库 ✅"); },
  exportZip:function(){
    var d=Store.get(), files=[["DB.json",X.json(d)],
      ["产品表.csv",X.csv([["编号","名称"]].concat(d.products.map(function(p){return [p.id,p.name];})))],
      ["价格表.csv",X.csv([["编号","零售","VIP","成本"]].concat(d.products.map(function(p){
        return [p.id,d.prices[p.id].retail,d.prices[p.id].vip,d.prices[p.id].cost];})))],
      ["说明.txt","双击 index.html 运行\n导入 DB.json 即可恢复全部数据\n"]];
    d.quotes.forEach(function(q){files.push(["报价-"+q.no+".html",X.quoteHTML(q)]);});
    d.invoices.forEach(function(i){files.push(["发货-"+i.no+".html",X.invoiceHTML(i)]);});
    X.zip(files); toast("整包已导出 ✅");
  },
  importAll:function(inp){
    var f=inp.files[0]; if(!f)return; var r=new FileReader(), self=this;
    r.onload=function(){ try{ Store.replace(JSON.parse(r.result)); toast("全库已恢复 ✅"); self.render(self.cur); }
      catch(e){ toast("导入失败："+e.message); } };
    r.readAsText(f,"utf-8"); inp.value="";
  },
  rollbackSnapshot:function(){ var d=Store.get(); if(!d.snapshots.length)return toast("无快照");
    var s=d.snapshots[d.snapshots.length-1]; Store.replace(s.data); toast("已回滚到 "+s.at.slice(0,19)); },
  reset:function(){ if(!confirm("确定清空并恢复 20 个初始产品？"))return; Store.replace(Store.fresh()); toast("已重置 ✅"); }
};

/* 启动：脚本已在 body 末尾，DOM 就绪 */
UI.init();