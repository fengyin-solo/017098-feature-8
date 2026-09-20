/**
 * 知识配置平台 - Mock 数据与 localStorage 持久化
 * 模块化命名空间结构
 */
(function (global) {
  'use strict';

  // ====================== 存储工具 ======================
  var STORAGE_PREFIX = 'knowledge_platform_';

  var StorageUtil = {
    load: function (key, fallback) {
      try {
        var s = localStorage.getItem(STORAGE_PREFIX + key);
        return s != null ? JSON.parse(s) : fallback;
      } catch (_) { return fallback; }
    },
    save: function (key, value) {
      try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch (_) {}
    },
    remove: function (key) {
      try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (_) {}
    }
  };

  // 兼容旧的变量名
  var P = STORAGE_PREFIX;
  function load(key, fallback) { return StorageUtil.load(key, fallback); }
  function save(key, value) { StorageUtil.save(key, value); }

  // ====================== 用户认证模块 ======================
  var defaultUsers = [
    { username: 'user', password: '123456', name: '管理员' }
  ];

  // ====================== 登录失败锁定策略 ======================
  // 同一用户名连续输错达到上限后，短暂锁定该用户名的登录提交
  var LOGIN_MAX_ATTEMPTS = 5;                 // 连续失败上限
  var LOGIN_LOCK_DURATION_MS = 60 * 1000;    // 锁定时长：60 秒

  function normalizeLoginUsername(username) {
    return String(username == null ? '' : username).trim();
  }
  function getLoginFailureMap() { return load('loginFailures', {}); }
  function saveLoginFailureMap(map) { save('loginFailures', map); }

  // 剩余锁定时间文案：x 分 xx 秒 / xx 秒
  function formatLockRemain(remainMs) {
    var totalSec = Math.max(0, Math.ceil(remainMs / 1000));
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    if (m > 0) return m + ' 分 ' + (s < 10 ? '0' + s : s) + ' 秒';
    return s + ' 秒';
  }

  // 锁定提示文案（登录页与其它入口共用，保证一致）
  function buildLockedMessage(remainMs) {
    return '连续输错 ' + LOGIN_MAX_ATTEMPTS + ' 次，账号已锁定，请 ' +
      formatLockRemain(remainMs) + ' 后再试';
  }

  // 未达上限时的失败提示文案
  function buildFailMessage(attemptsLeft) {
    return '用户名或密码错误，还可尝试 ' + attemptsLeft + ' 次';
  }

  var AuthModule = {
    // 登录限制配置（供页面读取展示）
    MAX_LOGIN_ATTEMPTS: LOGIN_MAX_ATTEMPTS,
    LOGIN_LOCK_DURATION: LOGIN_LOCK_DURATION_MS,
    formatLockRemain: formatLockRemain,
    getLockedMessage: function (remainMs) { return buildLockedMessage(remainMs); },

    // 获取用户列表
    getUsers: function () {
      return load('users', defaultUsers);
    },

    // 初始化默认用户（首次加载时调用）
    initUsers: function () {
      if (!localStorage.getItem(STORAGE_PREFIX + 'users')) {
        save('users', defaultUsers);
      }
    },

    /**
     * 读取某用户名当前的登录限制状态（只读取，不改记录）
     * 返回：{ locked, failCount, attemptsLeft, remainMs, lockExpired }
     * - locked：是否处于锁定期
     * - lockExpired：锁定已过期但记录尚未被首次成功登录清零
     */
    getLoginStatus: function (username) {
      var key = normalizeLoginUsername(username);
      var empty = {
        locked: false, failCount: 0,
        attemptsLeft: LOGIN_MAX_ATTEMPTS,
        remainMs: 0, lockExpired: false
      };
      if (!key) return empty;
      var rec = getLoginFailureMap()[key];
      if (!rec) return empty;
      var now = Date.now();
      if (rec.lockedUntil && now < rec.lockedUntil) {
        return {
          locked: true,
          failCount: rec.failCount || 0,
          attemptsLeft: 0,
          remainMs: rec.lockedUntil - now,
          lockedUntil: rec.lockedUntil,
          lockExpired: false
        };
      }
      // 锁定期已过：记录先保留（等首次成功登录清零），尝试次数重新给满
      if (rec.lockedUntil && now >= rec.lockedUntil) {
        return {
          locked: false,
          failCount: rec.failCount || 0,
          attemptsLeft: LOGIN_MAX_ATTEMPTS,
          remainMs: 0,
          lockExpired: true
        };
      }
      return {
        locked: false,
        failCount: rec.failCount || 0,
        attemptsLeft: Math.max(0, LOGIN_MAX_ATTEMPTS - (rec.failCount || 0)),
        remainMs: 0,
        lockExpired: false
      };
    },

    // 记录一次登录失败；达到上限即置锁定，返回最新状态
    recordLoginFailure: function (username) {
      var key = normalizeLoginUsername(username);
      if (!key) return this.getLoginStatus(key);
      var map = getLoginFailureMap();
      var now = Date.now();
      var rec = map[key];
      // 上一轮锁定已过期：开启新一轮计数（旧记录等成功登录时清零）
      if (rec && rec.lockedUntil && now >= rec.lockedUntil) {
        rec = { failCount: 0, lockedUntil: null, firstFailAt: now };
      }
      rec = rec || { failCount: 0, lockedUntil: null, firstFailAt: now };
      rec.failCount = (rec.failCount || 0) + 1;
      rec.lastFailAt = now;
      if (rec.failCount >= LOGIN_MAX_ATTEMPTS) {
        rec.lockedUntil = now + LOGIN_LOCK_DURATION_MS;
      }
      map[key] = rec;
      saveLoginFailureMap(map);
      return this.getLoginStatus(key);
    },

    // 成功登录后清零该用户名的失败记录
    clearLoginFailures: function (username) {
      var key = normalizeLoginUsername(username);
      if (!key) return;
      var map = getLoginFailureMap();
      if (map[key]) {
        delete map[key];
        saveLoginFailureMap(map);
      }
    },

    // 验证登录（含失败次数限制，前端 UI 的任何重复提交都绕不过这里的校验）
    login: function (username, password) {
      var key = normalizeLoginUsername(username);
      // 记住最近一次尝试登录的用户名，刷新或从首页/内页跳回时恢复锁定提示
      if (key) save('lastLoginUsername', key);

      // 锁定中：直接拒绝，不校验密码，也不延长锁定时间
      var status = this.getLoginStatus(key);
      if (status.locked) {
        return {
          success: false,
          code: 'LOCKED',
          locked: true,
          attemptsLeft: 0,
          remainMs: status.remainMs,
          message: buildLockedMessage(status.remainMs)
        };
      }

      var users = this.getUsers();
      var user = users.find(function (u) {
        return u.username === key && u.password === password;
      });
      if (user) {
        // 解除后第一次成功登录：失败记录清零
        this.clearLoginFailures(key);
        var session = {
          username: user.username,
          name: user.name,
          loginTime: Date.now()
        };
        save('session', session);
        return { success: true, user: session };
      }

      // 校验失败：按用户名落一条失败记录
      var next = this.recordLoginFailure(key);
      if (next.locked) {
        return {
          success: false,
          code: 'LOCKED_NOW',
          locked: true,
          attemptsLeft: 0,
          remainMs: next.remainMs,
          message: buildLockedMessage(next.remainMs)
        };
      }
      return {
        success: false,
        code: 'BAD_CREDENTIALS',
        locked: false,
        attemptsLeft: next.attemptsLeft,
        message: buildFailMessage(next.attemptsLeft)
      };
    },

    // 登出
    logout: function () {
      StorageUtil.remove('session');
    },

    // 获取当前登录用户
    getCurrentUser: function () {
      return load('session', null);
    },

    // 检查是否已登录
    isLoggedIn: function () {
      return this.getCurrentUser() !== null;
    },

    // 检查登录状态，未登录则跳转到登录页
    checkAuth: function () {
      if (!this.isLoggedIn()) {
        var currentPage = window.location.pathname.split('/').pop() || 'index.html';
        if (currentPage !== 'login.html') {
          window.location.href = 'login.html';
          return false;
        }
      }
      return true;
    }
  };

  // 初始化默认用户
  AuthModule.initUsers();

  // ====================== 初始商家数据 ======================
  var defaultMerchants = [
    { id: 'M001', name: '星巴克咖啡' },
    { id: 'M002', name: '海底捞火锅' },
    { id: 'M003', name: '优衣库' },
    { id: 'M004', name: '华为旗舰店' },
    { id: 'M005', name: '盒马鲜生' },
  ];

  // ====================== 初始商家集合数据 ======================
  var defaultMerchantSets = [
    { id: 'SET001', name: '连锁餐饮集合', merchantIds: ['M001', 'M002'] },
    { id: 'SET002', name: '服饰零售集合', merchantIds: ['M003'] },
    { id: 'SET003', name: '电子数码集合', merchantIds: ['M004'] },
    { id: 'SET004', name: '生鲜超市集合', merchantIds: ['M005'] },
  ];

  // ====================== 初始行业数据 ======================
  var defaultIndustries = [
    { id: 'IND_L1_retail', level1: '零售', level2: '', name: '零售' },
    { id: 'IND01', level1: '零售', level2: '生鲜零售', name: '零售 / 生鲜零售' },
    { id: 'IND02', level1: '零售', level2: '服装零售', name: '零售 / 服装零售' },
    { id: 'IND03', level1: '零售', level2: '家电零售', name: '零售 / 家电零售' },
    { id: 'IND_L1_food', level1: '餐饮', level2: '', name: '餐饮' },
    { id: 'IND04', level1: '餐饮', level2: '快餐', name: '餐饮 / 快餐' },
    { id: 'IND05', level1: '餐饮', level2: '茶饮', name: '餐饮 / 茶饮' },
    { id: 'IND06', level1: '餐饮', level2: '正餐', name: '餐饮 / 正餐' },
    { id: 'IND_L1_tech', level1: '科技', level2: '', name: '科技' },
    { id: 'IND07', level1: '科技', level2: '消费电子', name: '科技 / 消费电子' },
  ];

  // ====================== 商家知识初始数据 ======================
  var defaultMerchantKnowledge = {
    'M001': [
      { id: 'k_m001_1', standardQ: '星巴克的营业时间是什么？', similarQs: ['几点开门', '几点关门', '营业时间'], answer: '星巴克门店营业时间通常为早上7:00至晚上22:00，部分门店会根据所在商圈调整，请以门店实际公示为准。' },
      { id: 'k_m001_2', standardQ: '星巴克有哪些会员等级？', similarQs: ['会员制度', '会员权益', '星享卡'], answer: '星巴克会员分为银星级、玉星级和金星级三个等级。银星级无消费门槛，玉星级需累计250颗星星，金星级需累计500颗星星。不同等级享有不同的专属权益。' },
      { id: 'k_m001_3', standardQ: '如何获取星巴克优惠券？', similarQs: ['折扣', '优惠活动', '打折'], answer: '您可以通过星巴克APP、微信小程序参与会员活动获取优惠券，也可以关注星巴克官方公众号获取最新优惠信息。每周二是会员日，会有专属优惠。' },
      { id: 'k_m001_4', standardQ: '星巴克支持哪些支付方式？', similarQs: ['怎么付款', '能用什么支付', '付款方式'], answer: '星巴克支持微信支付、支付宝、银联云闪付、星巴克APP内置支付、星礼卡以及现金等多种支付方式。' },
    ],
    'M002': [
      { id: 'k_m002_1', standardQ: '海底捞如何预约排队？', similarQs: ['怎么订位', '预约', '排号'], answer: '您可以通过海底捞APP、微信小程序或拨打门店电话进行预约。APP和小程序支持在线取号排队，可实时查看排队进度。建议提前1-2小时预约。' },
      { id: 'k_m002_2', standardQ: '海底捞有哪些免费服务？', similarQs: ['免费项目', '赠送服务', '附加服务'], answer: '海底捞提供免费美甲、擦鞋、手机贴膜、儿童游乐区、零食水果、热毛巾、围裙、手机袋等服务。等位期间还可享受免费小吃和饮品。' },
      { id: 'k_m002_3', standardQ: '海底捞可以自带食材吗？', similarQs: ['能带东西吗', '自带酒水', '外带食物'], answer: '抱歉，出于食品安全考虑，海底捞门店不允许自带食材。但您可以自带酒水，部分门店可能收取开瓶费，具体请咨询门店。' },
      { id: 'k_m002_4', standardQ: '海底捞的锅底有哪些选择？', similarQs: ['火锅底料', '汤底', '锅底种类'], answer: '海底捞提供多种锅底选择：经典牛油麻辣锅、清油麻辣锅、番茄锅、菌汤锅、三鲜锅、清水锅等。推荐鸳鸯锅，可以同时品尝两种口味。' },
      { id: 'k_m002_5', standardQ: '海底捞会员有什么优惠？', similarQs: ['会员权益', '积分', '会员折扣'], answer: '海底捞会员可累积捞币兑换菜品、享受生日特权、优先排队等权益。黑海会员还可享受专属折扣和免费菜品赠送。' },
    ],
    'M003': [
      { id: 'k_m003_1', standardQ: '优衣库的退换货政策是什么？', similarQs: ['退货', '换货', '售后'], answer: '优衣库支持30天内无理由退换货，商品需保持原样、吊牌完整。线上购买可在门店退换或申请快递上门取件。内衣内裤类商品不支持退换。' },
      { id: 'k_m003_2', standardQ: '优衣库如何查询库存？', similarQs: ['有没有货', '库存查询', '门店有货吗'], answer: '您可以通过优衣库APP或官网查询指定门店的商品库存情况。也可以拨打门店电话或到店咨询。线上显示有货的商品可选择门店自提。' },
      { id: 'k_m003_3', standardQ: '优衣库有免费改裤长服务吗？', similarQs: ['改裤脚', '裤长修改', '免费修改'], answer: '是的，优衣库提供免费改裤长服务。购买裤装后可在门店免费修改裤长，通常当天可取，部分门店可能需要等待1-2天。' },
      { id: 'k_m003_4', standardQ: '优衣库UTme是什么服务？', similarQs: ['定制T恤', '个性化', '自己设计'], answer: 'UTme是优衣库的T恤定制服务，您可以在指定门店使用自己的照片或设计图案定制专属T恤。制作时间约30分钟，价格根据款式和尺码有所不同。' },
    ],
    'M004': [
      { id: 'k_m004_1', standardQ: '华为手机保修期是多久？', similarQs: ['质保', '保修政策', '售后保障'], answer: '华为手机主机保修期为1年，电池保修6个月，充电器保修1年。购买华为Care+服务可延长保修期并享受意外损坏保障。' },
      { id: 'k_m004_2', standardQ: '华为门店可以以旧换新吗？', similarQs: ['旧机回收', '换新', '折价'], answer: '是的，华为旗舰店支持以旧换新服务。您可以将旧手机（不限品牌）折价抵扣购买新机，评估价格根据机型和成色确定。' },
      { id: 'k_m004_3', standardQ: '华为产品如何预约维修？', similarQs: ['售后维修', '预约服务', '手机坏了'], answer: '您可以通过华为官网、华为APP或拨打400-830-8300预约维修服务。也可以直接到华为授权服务中心，建议提前预约以减少等待时间。' },
      { id: 'k_m004_4', standardQ: '华为门店有分期付款吗？', similarQs: ['分期', '免息', '信用卡分期'], answer: '是的，华为旗舰店支持多种分期付款方式，包括花呗分期、信用卡分期等。部分产品支持12期或24期免息，具体以门店活动为准。' },
    ],
    'M005': [
      { id: 'k_m005_1', standardQ: '盒马鲜生的配送范围是多少？', similarQs: ['送货范围', '能配送吗', '配送距离'], answer: '盒马鲜生提供门店周边3公里范围内的配送服务，30分钟送达。您可以在APP上输入地址查看是否在配送范围内。' },
      { id: 'k_m005_2', standardQ: '盒马的海鲜可以现场加工吗？', similarQs: ['加工海鲜', '现做', '烹饪服务'], answer: '是的，盒马门店提供海鲜现场加工服务。您购买海鲜后可以选择清蒸、爆炒、椒盐等多种烹饪方式，加工费根据烹饪方式和重量计算。' },
      { id: 'k_m005_3', standardQ: '盒马会员有什么权益？', similarQs: ['X会员', '会员服务', '开通会员'], answer: '盒马X会员年费218元，享有全年88折优惠（部分商品除外）、专属会员价商品、免费配送次数提升、会员日双倍积分等权益。' },
      { id: 'k_m005_4', standardQ: '盒马APP下单后可以门店自提吗？', similarQs: ['到店取货', '自提', '门店取'], answer: '是的，盒马支持门店自提服务。下单时选择"门店自提"，到店后出示取货码即可领取商品。自提订单通常1小时内备货完成。' },
    ],
  };

  // ====================== 商家集合知识初始数据 ======================
  var defaultMerchantSetKnowledge = {
    'SET001': [
      { id: 'k_set001_1', standardQ: '连锁餐饮如何统一管理优惠活动？', similarQs: ['活动管理', '促销统一', '连锁优惠'], answer: '连锁餐饮品牌通常通过总部统一下发活动配置，各门店同步执行。您可以关注品牌官方渠道获取最新活动信息，全国门店通用。' },
      { id: 'k_set001_2', standardQ: '连锁餐饮的会员积分可以通用吗？', similarQs: ['积分互通', '跨店使用', '会员通用'], answer: '是的，连锁餐饮品牌的会员积分一般全国门店通用，您在任意门店消费获得的积分可以在其他门店使用兑换。' },
      { id: 'k_set001_3', standardQ: '如何投诉连锁餐饮门店服务问题？', similarQs: ['投诉', '反馈', '服务问题'], answer: '您可以通过品牌官方APP、微信公众号提交投诉，或拨打品牌客服热线反馈。连锁品牌通常有统一的客诉处理机制，会在24-48小时内响应。' },
    ],
    'SET002': [
      { id: 'k_set002_1', standardQ: '服饰零售的尺码如何选择？', similarQs: ['尺码表', '选码', '衣服大小'], answer: '建议参考品牌官网的尺码表，根据身高体重选择。如不确定可以到店试穿，或选择支持退换货的线上渠道购买。' },
      { id: 'k_set002_2', standardQ: '服装洗涤保养有什么注意事项？', similarQs: ['洗衣服', '保养', '清洗方法'], answer: '请按照衣物水洗标进行洗涤。一般建议棉质衣物可机洗，羊毛、丝绸类建议干洗或手洗。深浅颜色衣物分开洗涤，避免褪色。' },
      { id: 'k_set002_3', standardQ: '服饰零售有新品上市通知吗？', similarQs: ['新款', '上新', '新品预告'], answer: '您可以关注品牌官方公众号或开启APP推送通知，第一时间获取新品上市信息。部分品牌会员可享受新品优先购买权。' },
      { id: 'k_set002_4', standardQ: '如何参与服饰品牌的折扣季活动？', similarQs: ['打折', '促销', '折扣活动'], answer: '品牌折扣季通常在换季时举行，可通过官方渠道获取活动时间。建议提前关注并加入会员，会员通常可提前参与或享受更大折扣。' },
    ],
    'SET003': [
      { id: 'k_set003_1', standardQ: '电子产品购买后如何激活保修？', similarQs: ['保修激活', '注册', '保障'], answer: '购买电子产品后，建议通过官方APP或网站注册设备，绑定购买凭证以激活保修。部分产品首次开机联网会自动激活。' },
      { id: 'k_set003_2', standardQ: '电子数码产品的最佳购买时机是什么时候？', similarQs: ['什么时候买', '优惠时间', '促销'], answer: '618、双11、品牌周年庆是电子产品优惠力度较大的时期。新品发布后老款也会有较大降价。建议关注品牌官方活动日历。' },
      { id: 'k_set003_3', standardQ: '电子产品如何鉴别正品？', similarQs: ['验真', '正品验证', '防伪'], answer: '建议在品牌官方渠道或授权经销商购买。收到产品后可通过官网防伪查询、扫描包装防伪码或APP验证等方式确认正品。' },
    ],
    'SET004': [
      { id: 'k_set004_1', standardQ: '生鲜超市的商品如何保证新鲜度？', similarQs: ['新鲜', '保质', '品质保障'], answer: '生鲜超市采用冷链配送、日配到店等方式保证商品新鲜度。大部分生鲜商品当日售完，蔬果类通常每日多次补货。' },
      { id: 'k_set004_2', standardQ: '生鲜商品有质量问题怎么办？', similarQs: ['退货', '换货', '品质问题'], answer: '如收到的生鲜商品存在质量问题，可在签收后24小时内通过APP申请售后，上传问题照片后可选择退款或补发。' },
      { id: 'k_set004_3', standardQ: '生鲜超市支持预约配送吗？', similarQs: ['定时配送', '预约时间', '送货时间'], answer: '大部分生鲜超市支持选择配送时间段，您可以在下单时选择希望的送达时间。建议提前下单以确保心仪的时间段有位。' },
      { id: 'k_set004_4', standardQ: '生鲜超市有哪些配送费优惠？', similarQs: ['免配送费', '运费', '配送费减免'], answer: '通常订单满一定金额可免配送费（如满39元免费配送）。开通会员后配送费门槛更低或享受免费配送次数。' },
    ],
  };

  // ====================== 行业知识初始数据 ======================
  var defaultIndustryKnowledge = {
    'IND01': [
      { id: 'k_ind01_1', standardQ: '生鲜零售如何保证食品安全？', similarQs: ['食品安全', '卫生', '质量保障'], answer: '生鲜零售行业需遵守食品安全法规，建立完善的冷链体系，定期检测商品，确保可追溯性。消费者可查看商品溯源码了解产地信息。' },
      { id: 'k_ind01_2', standardQ: '生鲜商品的最佳保存方法是什么？', similarQs: ['保存', '储存', '保鲜'], answer: '蔬菜建议冷藏保存，根茎类可常温；肉类需冷冻或当日食用；海鲜建议当日烹饪或急冻保存。不同食材保存温度和时间不同，请参考包装说明。' },
      { id: 'k_ind01_3', standardQ: '生鲜零售退货政策一般是什么？', similarQs: ['退货', '售后', '退款'], answer: '生鲜商品因特殊性，通常支持签收后24小时内有品质问题可退换。建议收货时当面验收，发现问题及时拍照留证申请售后。' },
    ],
    'IND02': [
      { id: 'k_ind02_1', standardQ: '服装零售的流行趋势如何了解？', similarQs: ['流行', '时尚', '潮流'], answer: '可关注时尚杂志、社交媒体时尚博主、品牌官方发布会等渠道。各大服装品牌每季发布新品也是了解趋势的好方式。' },
      { id: 'k_ind02_2', standardQ: '服装尺码不同品牌一样吗？', similarQs: ['尺码差异', '码数', '选码'], answer: '不同品牌的尺码标准可能存在差异，建议参考各品牌的尺码对照表。同一品牌不同系列也可能有所不同，建议试穿后购买。' },
      { id: 'k_ind02_3', standardQ: '服装零售有价格保护政策吗？', similarQs: ['降价退差', '价保', '保价'], answer: '部分品牌和平台提供7-15天价格保护服务，如购买后商品降价可申请退差价。具体政策以各品牌和购买渠道的规定为准。' },
      { id: 'k_ind02_4', standardQ: '如何辨别服装面料质量？', similarQs: ['面料', '材质', '质量鉴别'], answer: '查看成分标签了解面料构成；手感柔软、有垂感通常质量较好；查看走线是否整齐、有无脱线；优质面料不易起球变形。' },
    ],
    'IND03': [
      { id: 'k_ind03_1', standardQ: '家电零售的安装服务怎么预约？', similarQs: ['安装', '上门', '预约服务'], answer: '购买大家电后通常会安排送装一体服务。您也可以通过品牌官方APP、客服热线预约安装时间。建议提前确认安装环境是否符合要求。' },
      { id: 'k_ind03_2', standardQ: '家电产品全国联保是什么意思？', similarQs: ['联保', '保修', '售后服务'], answer: '全国联保指在全国任意授权服务网点均可享受保修服务。购买时请保留好发票和保修卡，作为保修凭证。' },
      { id: 'k_ind03_3', standardQ: '家电以旧换新政策是什么？', similarQs: ['旧机回收', '换新', '以旧换新'], answer: '各品牌和卖场会不定期推出以旧换新活动，旧家电可折价抵扣购买新机。具体折价标准根据机型、成色和活动政策确定。' },
    ],
    'IND04': [
      { id: 'k_ind04_1', standardQ: '快餐行业的食品卫生标准是什么？', similarQs: ['卫生', '安全', '标准'], answer: '快餐行业需遵守餐饮服务食品安全操作规范，包括食材采购、储存、加工、配送等环节的卫生要求。可查看门店的食品经营许可证和卫生等级公示。' },
      { id: 'k_ind04_2', standardQ: '快餐外卖配送超时怎么处理？', similarQs: ['超时', '配送晚了', '延误'], answer: '各平台对配送超时有相应补偿政策，通常会自动给予优惠券或小额退款。严重超时可联系客服申请额外补偿或退款。' },
      { id: 'k_ind04_3', standardQ: '快餐行业如何确保出餐速度？', similarQs: ['出餐快', '效率', '等待时间'], answer: '快餐品牌通过标准化流程、预制菜品、智能设备等方式提升出餐效率。高峰期建议提前APP点餐或选择自助点餐机下单。' },
    ],
    'IND05': [
      { id: 'k_ind05_1', standardQ: '茶饮行业用的是什么茶叶？', similarQs: ['原料', '茶底', '茶叶来源'], answer: '知名茶饮品牌通常选用优质茶叶原料，建立自有茶园或与优质茶园合作。可通过品牌官网了解原料产地和品质信息。' },
      { id: 'k_ind05_2', standardQ: '茶饮的甜度和冰量可以调整吗？', similarQs: ['少糖', '去冰', '个性化'], answer: '大部分茶饮品牌支持甜度（全糖/七分/五分/三分/无糖）和冰量（正常冰/少冰/去冰/常温/热饮）的个性化选择。' },
      { id: 'k_ind05_3', standardQ: '茶饮行业有哪些热门品类？', similarQs: ['什么好喝', '推荐', '热门'], answer: '当前热门品类包括：鲜果茶、奶茶、纯茶、芝士茶、气泡茶等。各品牌招牌产品和季节限定款通常最受欢迎。' },
      { id: 'k_ind05_4', standardQ: '茶饮外卖口感会变差吗？', similarQs: ['配送影响', '外卖品质', '口感'], answer: '长时间配送可能影响茶饮口感，特别是含冰饮品。建议选择较近门店下单，收到后尽快饮用。部分饮品建议到店自取。' },
    ],
    'IND06': [
      { id: 'k_ind06_1', standardQ: '正餐餐厅如何预订包间？', similarQs: ['订包间', '预约', '包厢'], answer: '可通过餐厅官方电话、大众点评等平台预约包间。包间通常有最低消费要求，建议提前1-2天预订，节假日需更早预约。' },
      { id: 'k_ind06_2', standardQ: '正餐餐厅支持定制菜单吗？', similarQs: ['宴会', '定制', '特殊需求'], answer: '大部分正餐餐厅支持商务宴请、生日宴会等场景的菜单定制服务。可提前与餐厅沟通用餐人数、预算和特殊要求。' },
      { id: 'k_ind06_3', standardQ: '正餐餐厅的服务费怎么收？', similarQs: ['服务费', '额外收费', '费用'], answer: '部分高档餐厅会收取10%-15%的服务费，通常会在菜单或结账时说明。建议点餐前确认是否有额外费用。' },
    ],
    'IND07': [
      { id: 'k_ind07_1', standardQ: '消费电子产品的保修政策一般是什么？', similarQs: ['保修', '质保', '售后'], answer: '消费电子产品通常提供1年主机保修，配件保修期可能不同。建议购买时了解具体保修政策，部分品牌提供延保服务。' },
      { id: 'k_ind07_2', standardQ: '消费电子新品发布后老款会降价吗？', similarQs: ['降价', '老款', '价格变化'], answer: '通常新品发布后老款产品会有一定幅度降价，特别是年度旗舰更新时。如不追求最新功能，购买上一代产品性价比更高。' },
      { id: 'k_ind07_3', standardQ: '如何选择适合自己的电子产品？', similarQs: ['怎么选', '选购建议', '推荐'], answer: '建议根据实际使用需求和预算选择。明确主要用途（如办公、娱乐、创作），对比不同价位产品的核心参数，参考专业评测和用户评价。' },
      { id: 'k_ind07_4', standardQ: '电子产品支持以旧换新吗？', similarQs: ['旧机换新', '回收', '折价'], answer: '大部分电子品牌和零售商支持以旧换新服务，旧设备可折价抵扣新机。估价根据机型、容量、成色等因素确定，可通过官方渠道在线估价。' },
    ],
  };

  // ====================== 通用知识初始数据 ======================
  var defaultGlobalKnowledge = [
    { id: 'k_global_1', standardQ: '如何联系客服？', similarQs: ['客服电话', '在线客服', '联系方式'], answer: '您可以通过APP内的在线客服、官方客服热线400-xxx-xxxx（工作时间9:00-21:00）或官方微信公众号联系客服。' },
    { id: 'k_global_2', standardQ: '订单如何申请退款？', similarQs: ['退款流程', '取消订单', '申请退货'], answer: '登录APP进入"我的订单"，选择需要退款的订单，点击"申请退款"并选择退款原因。未发货订单可直接退款，已发货订单需等待商品退回后处理。' },
    { id: 'k_global_3', standardQ: '如何修改收货地址？', similarQs: ['改地址', '收货信息', '配送地址'], answer: '未发货订单可在订单详情页修改收货地址。已发货订单请联系客服协助处理，但不保证一定能修改成功。' },
    { id: 'k_global_4', standardQ: '支付遇到问题怎么办？', similarQs: ['支付失败', '付款问题', '支付异常'], answer: '如遇支付失败，请检查网络连接、支付密码是否正确、银行卡余额是否充足。若扣款成功但订单未生成，款项通常会在1-3个工作日内原路退回。' },
    { id: 'k_global_5', standardQ: '如何开具发票？', similarQs: ['发票', '开票', '电子发票'], answer: '下单时可选择开具发票类型（电子普票/专票）。订单完成后也可在"我的订单"中申请补开发票。电子发票会发送到您预留的邮箱。' },
  ];

  // ====================== 黑名单初始数据 ======================
  var defaultBlacklistMerchantIds = ['M002'];

  // 一级行业选项（用于下拉）
  var industryLevel1Options = ['零售', '餐饮', '教育', '医疗', '金融', '科技'];

  var industryLevel2Map = {
    '零售': ['生鲜零售', '服装零售', '家电零售', '便利店'],
    '餐饮': ['快餐', '正餐', '茶饮', '烘焙'],
    '教育': ['K12', '职业教育', '语言培训', '早教'],
    '医疗': ['综合医院', '专科', '诊所', '体检'],
    '金融': ['银行', '保险', '证券', '支付'],
    '科技': ['软件', '硬件', '互联网', '云计算'],
  };

  // 生成短 ID，格式如 M006、SET005、k_abc123
  function nextId(prefix, existingList) {
    // 知识条目使用短时间戳
    if (prefix === 'k') {
      return 'k_' + Date.now().toString(36);
    }
    
    // 其他类型使用递增编号
    var maxNum = 0;
    var list = existingList || [];
    
    // 找出当前最大编号
    list.forEach(function (item) {
      if (item.id) {
        // 匹配 M001, SET001, IND01 等格式
        var match = item.id.match(/(\d+)$/);
        if (match) {
          var num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    });
    
    // 生成下一个编号，补零到3位
    var nextNum = maxNum + 1;
    var padded = ('000' + nextNum).slice(-3);
    return prefix + padded;
  }

  var store = {
    getMerchants: function () {
      return load('merchants', defaultMerchants);
    },
    setMerchants: function (list) {
      save('merchants', list);
      return list;
    },
    createMerchant: function (name, id) {
      var list = store.getMerchants().slice();
      var finalId = (id && String(id).trim()) ? String(id).trim() : nextId('M', list);
      list.push({ id: finalId, name: name || '新商家' });
      save('merchants', list);
      var all = load('merchantKnowledge', {});
      all[finalId] = [];
      save('merchantKnowledge', all);
      return list[list.length - 1];
    },
    updateMerchant: function (id, name) {
      var list = store.getMerchants().map(function (m) {
        if (m.id !== id) return m;
        return { id: m.id, name: name != null ? name : m.name };
      });
      save('merchants', list);
      return list;
    },
    deleteMerchant: function (id) {
      var list = store.getMerchants().filter(function (m) { return m.id !== id; });
      save('merchants', list);
      var all = load('merchantKnowledge', {});
      delete all[id];
      save('merchantKnowledge', all);
      return list;
    },
    getMerchantKnowledge: function (merchantId) {
      var all = load('merchantKnowledge', defaultMerchantKnowledge);
      return all[merchantId] || [];
    },
    setMerchantKnowledge: function (merchantId, list) {
      var all = load('merchantKnowledge', defaultMerchantKnowledge);
      all[merchantId] = list;
      save('merchantKnowledge', all);
      return list;
    },
    addMerchantKnowledge: function (merchantId, item) {
      var list = store.getMerchantKnowledge(merchantId).slice();
      item.id = item.id || nextId('k');
      list.push(item);
      store.setMerchantKnowledge(merchantId, list);
      return item;
    },
    updateMerchantKnowledge: function (merchantId, id, item) {
      var list = store.getMerchantKnowledge(merchantId).map(function (k) {
        return k.id === id ? Object.assign({}, k, item, { id: id }) : k;
      });
      store.setMerchantKnowledge(merchantId, list);
      return list;
    },
    deleteMerchantKnowledge: function (merchantId, id) {
      var list = store.getMerchantKnowledge(merchantId).filter(function (k) { return k.id !== id; });
      store.setMerchantKnowledge(merchantId, list);
      return list;
    },
    checkMerchantKnowledgeDuplicates: function (merchantId, items) {
      var existing = store.getMerchantKnowledge(merchantId);
      var existingQMap = {};
      existing.forEach(function (k) {
        existingQMap[k.standardQ] = k;
      });
      return items.map(function (item) {
        var dup = existingQMap[item.standardQ] || null;
        return {
          item: item,
          isDuplicate: !!dup,
          existingItem: dup
        };
      });
    },
    batchAddMerchantKnowledge: function (merchantId, items) {
      var list = store.getMerchantKnowledge(merchantId).slice();
      var added = [];
      items.forEach(function (item) {
        item.id = item.id || nextId('k');
        list.push(item);
        added.push(item);
      });
      store.setMerchantKnowledge(merchantId, list);
      return added;
    },

    getMerchantSets: function () {
      return load('merchantSets', defaultMerchantSets);
    },
    setMerchantSets: function (list) {
      save('merchantSets', list);
      return list;
    },
    createMerchantSet: function (name, merchantIds) {
      var sets = store.getMerchantSets().slice();
      var id = nextId('SET', sets);
      sets.push({ id: id, name: name, merchantIds: merchantIds || [] });
      save('merchantSets', sets);
      var all = load('merchantSetKnowledge', {});
      all[id] = [];
      save('merchantSetKnowledge', all);
      return sets[sets.length - 1];
    },
    updateMerchantSet: function (id, name, merchantIds) {
      var sets = store.getMerchantSets().map(function (s) {
        if (s.id !== id) return s;
        return { id: s.id, name: name != null ? name : s.name, merchantIds: merchantIds != null ? merchantIds : s.merchantIds };
      });
      save('merchantSets', sets);
      return sets;
    },
    deleteMerchantSet: function (id) {
      var sets = store.getMerchantSets().filter(function (s) { return s.id !== id; });
      save('merchantSets', sets);
      var all = load('merchantSetKnowledge', {});
      delete all[id];
      save('merchantSetKnowledge', all);
      return sets;
    },
    getMerchantSetKnowledge: function (setId) {
      var all = load('merchantSetKnowledge', defaultMerchantSetKnowledge);
      return all[setId] || [];
    },
    setMerchantSetKnowledge: function (setId, list) {
      var all = load('merchantSetKnowledge', defaultMerchantSetKnowledge);
      all[setId] = list;
      save('merchantSetKnowledge', all);
      return list;
    },
    addMerchantSetKnowledge: function (setId, item) {
      var list = store.getMerchantSetKnowledge(setId).slice();
      item.id = item.id || nextId('k');
      list.push(item);
      store.setMerchantSetKnowledge(setId, list);
      return item;
    },
    updateMerchantSetKnowledge: function (setId, id, item) {
      var list = store.getMerchantSetKnowledge(setId).map(function (k) {
        return k.id === id ? Object.assign({}, k, item, { id: id }) : k;
      });
      store.setMerchantSetKnowledge(setId, list);
      return list;
    },
    deleteMerchantSetKnowledge: function (setId, id) {
      var list = store.getMerchantSetKnowledge(setId).filter(function (k) { return k.id !== id; });
      store.setMerchantSetKnowledge(setId, list);
      return list;
    },

    getIndustries: function () {
      return load('industries', defaultIndustries);
    },
    setIndustries: function (list) {
      save('industries', list);
      return list;
    },
    /** 新增行业：level2 为空表示一级行业，否则为二级行业（挂在该 level1 下） */
    createIndustry: function (level1, level2) {
      var list = store.getIndustries().slice();
      var id = nextId('IND', list);
      var name = (level2 == null || level2 === '') ? level1 : (level1 + ' / ' + level2);
      list.push({ id: id, level1: level1, level2: level2 || '', name: name });
      save('industries', list);
      var all = load('industryKnowledge', {});
      all[id] = [];
      save('industryKnowledge', all);
      return list[list.length - 1];
    },
    updateIndustry: function (id, level1, level2) {
      var list = store.getIndustries().map(function (i) {
        if (i.id !== id) return i;
        var name = (level2 == null || level2 === '') ? level1 : (level1 + ' / ' + level2);
        return { id: i.id, level1: level1, level2: level2 || '', name: name };
      });
      save('industries', list);
      return list;
    },
    deleteIndustry: function (id) {
      var list = store.getIndustries().filter(function (i) { return i.id !== id; });
      save('industries', list);
      var all = load('industryKnowledge', {});
      delete all[id];
      save('industryKnowledge', all);
      return list;
    },
    getIndustryKnowledge: function (industryId) {
      var all = load('industryKnowledge', defaultIndustryKnowledge);
      return all[industryId] || [];
    },
    setIndustryKnowledge: function (industryId, list) {
      var all = load('industryKnowledge', defaultIndustryKnowledge);
      all[industryId] = list;
      save('industryKnowledge', all);
      return list;
    },
    addIndustryKnowledge: function (industryId, item) {
      var list = store.getIndustryKnowledge(industryId).slice();
      item.id = item.id || nextId('k');
      list.push(item);
      store.setIndustryKnowledge(industryId, list);
      return item;
    },
    updateIndustryKnowledge: function (industryId, id, item) {
      var list = store.getIndustryKnowledge(industryId).map(function (k) {
        return k.id === id ? Object.assign({}, k, item, { id: id }) : k;
      });
      store.setIndustryKnowledge(industryId, list);
      return list;
    },
    deleteIndustryKnowledge: function (industryId, id) {
      var list = store.getIndustryKnowledge(industryId).filter(function (k) { return k.id !== id; });
      store.setIndustryKnowledge(industryId, list);
      return list;
    },

    getGlobalKnowledge: function () {
      return load('globalKnowledge', defaultGlobalKnowledge);
    },
    setGlobalKnowledge: function (list) {
      save('globalKnowledge', list);
      return list;
    },
    addGlobalKnowledge: function (item) {
      var list = store.getGlobalKnowledge().slice();
      item.id = item.id || nextId('k');
      list.push(item);
      save('globalKnowledge', list);
      return item;
    },
    updateGlobalKnowledge: function (id, item) {
      var list = store.getGlobalKnowledge().map(function (k) {
        return k.id === id ? Object.assign({}, k, item, { id: id }) : k;
      });
      save('globalKnowledge', list);
      return list;
    },
    deleteGlobalKnowledge: function (id) {
      var list = store.getGlobalKnowledge().filter(function (k) { return k.id !== id; });
      save('globalKnowledge', list);
      return list;
    },

    getBlacklist: function () {
      return load('blacklistMerchantIds', defaultBlacklistMerchantIds);
    },
    setBlacklist: function (ids) {
      save('blacklistMerchantIds', ids);
      return ids;
    },
    addBlacklist: function (merchantId) {
      var ids = store.getBlacklist().slice();
      if (ids.indexOf(merchantId) === -1) ids.push(merchantId);
      save('blacklistMerchantIds', ids);
      return ids;
    },
    removeBlacklist: function (merchantId) {
      var ids = store.getBlacklist().filter(function (id) { return id !== merchantId; });
      save('blacklistMerchantIds', ids);
      return ids;
    },

    industryLevel1Options: industryLevel1Options,
    industryLevel2Map: industryLevel2Map,

    /** 概览统计：商家数、各类知识条数、知识总数 */
    getOverviewStats: function () {
      var merchants = store.getMerchants();
      var sets = store.getMerchantSets();
      var industries = store.getIndustries();
      var merchantKnowledgeCount = 0;
      merchants.forEach(function (m) {
        merchantKnowledgeCount += (store.getMerchantKnowledge(m.id) || []).length;
      });
      var merchantSetKnowledgeCount = 0;
      sets.forEach(function (s) {
        merchantSetKnowledgeCount += (store.getMerchantSetKnowledge(s.id) || []).length;
      });
      var industryKnowledgeCount = 0;
      industries.forEach(function (i) {
        industryKnowledgeCount += (store.getIndustryKnowledge(i.id) || []).length;
      });
      var globalCount = (store.getGlobalKnowledge() || []).length;
      return {
        merchantCount: merchants.length,
        merchantKnowledgeCount: merchantKnowledgeCount,
        merchantSetCount: sets.length,
        merchantSetKnowledgeCount: merchantSetKnowledgeCount,
        industryCount: industries.length,
        industryKnowledgeCount: industryKnowledgeCount,
        globalKnowledgeCount: globalCount,
        totalKnowledgeCount: merchantKnowledgeCount + merchantSetKnowledgeCount + industryKnowledgeCount + globalCount,
      };
    },
  };

  // ====================== 导出模块 ======================
  // 将 AuthModule 挂载到 store 上
  store.Auth = AuthModule;

  // 导出到全局
  global.MockStore = store;
  global.AuthModule = AuthModule;
  global.StorageUtil = StorageUtil;
})(typeof window !== 'undefined' ? window : this);
