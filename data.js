/* ============================================================
   data.js —— 初始数据（普通全局变量，非 module、不用 fetch）
   必须放在 app.js 之前加载
   ============================================================ */
var SEED = (function () {
  var names = [
    ["笔记本 A5 横线本","本"],   ["中性笔 0.5 黑色","支"],   ["文件夹 A4 双夹","个"],
    ["便利贴 76×76 黄色","本"], ["订书机 标准型","个"],     ["订书钉 12号 盒装","盒"],
    ["透明胶带 小号","卷"],     ["剪刀 办公款","把"],       ["尺子 30cm 塑料","把"],
    ["橡皮 白色","块"],         ["文件袋 拉链式","个"],     ["标签贴 打印型","张"],
    ["白板笔 可擦","支"],       ["计算器 桌面型","台"],     ["USB 数据线 Type-C","根"],
    ["鼠标垫 大号","张"],       ["收纳盒 塑料","个"],       ["便签夹 金属","个"],
    ["打印纸 A4 500张","包"],   ["桌面收纳架","个"]
];

  var products = names.map(function (x, i) {
    return {
      id: "P" + String(i + 1).padStart(3, "0"),
      name: x[0], unit: x[1],
      spec: i < 6 ? "标准版" : "通用",
      cat:  i < 6 ? "软件" : (i < 12 ? "素材" : (i < 18 ? "工具" : "服务")),
      note: "", enabled: true
    };
  });

  var prices = {}, stock = {};
  products.forEach(function (p, i) {
    var retail = +(19.9 + i * 7.3).toFixed(1);
    prices[p.id] = {
      retail: retail,
      vip: +(retail * 0.88).toFixed(1),
      cost: +(retail * 0.45).toFixed(1),
      history: [{ t: new Date().toISOString(), p: retail, by: "初始" }]
    };
    stock[p.id] = {
      "A区": { qty: 40 + i * 3, reserved: 0, safe: 15 },
      "B区": { qty: 10 + i,     reserved: 0, safe: 8  },
      "C区": { qty: 0,          reserved: 0, safe: 5  }
    };
  });

  return {
    meta: {
      version: 1,
      shop: "成成小店",
      taxRate: 0,
      warehouses: ["A区", "B区", "C区"],
      next: { Q: 1, D: 1, M: 1, C: 1 },
      updated: ""
    },
    products: products,
    prices: prices,
    stock: stock,
    customers: [{ id:"C001", name:"示例客户", contact:"张三", phone:"", addr:"", note:"" }],
    quotes: [], messages: [], invoices: [],
    stockLogs: [], audit: [], snapshots: []
  };
})();

/* 10 个 Tab 定义（app.js 会读） */
var TABS = [
  ["home","🏠 驾驶舱"], ["products","📦 产品"], ["prices","💰 价格表"],
  ["quotes","📄 报价表"], ["messages","💬 消息中心"], ["invoices","🚚 发货单"],
  ["stock","🏭 仓库库存"], ["customers","👥 客户"], ["report","📊 报表"],
  ["system","⚙️ 系统"]
];