# 知识配置平台 - 中后台

运营端知识配置中后台：商家知识、商家集合知识、行业知识、通用知识及商家黑名单管理。纯前端展示，数据使用 Mock + localStorage 持久化。

## 登录信息

系统启动后需要登录才能访问，默认账号密码：

| 用户名 | 密码 |
|--------|------|
| `user` | `123456` |

> 登录失败保护：同一用户名连续输错 **5** 次密码后，账号将被锁定 **5 分钟**。未达上限时每次失败都会提示剩余次数；锁定期间登录按钮保持禁用并显示解锁倒计时，重复提交或重新从首页/内页进入登录页均无法绕过；锁定到期自动恢复，成功登录后失败记录立即清零。记录按用户名保存在 localStorage。

## 题目要求

``` 
帮我搞一个中后台管理的中后台页面，尽量 html+js+css，tailwind 什么的 
纯展示。 
背景是：我在做一个知识的配置平台，支持运营能增删改查 

具体需求如下： 
知识的基础字段就是：标准问、相似问、答案 

知识能挂在不同的类型下： 
- 商家知识：挂在某个商家 id 下 
- 支持筛选出已有商家并编辑查看知识 
- 商家集合知识：挂在某批商家 id 下 
- 支持新建一个商家集合：有商家选择能力 
- 增删改查知识 
- 行业知识：挂在某个行业的 id 下 
支持新增行业：有行业选择能力（二级行业） 
- 增删改查知识 
- 通用支持：对所有的商家、行业生效 
- 支持设置商家黑名单：黑名单中的商家不生效通用知识 
- 增删改查知识 

页面搞下？
``` 

## 最终交付：Docker 启动

**唯一启动命令**（无需预装 Node 或其它运行时）：

```bash
docker compose up
```

首次运行会自动构建镜像；之后直接启动。启动成功后，控制台会显式输出：

```
==============================================
  Startup Success
  Frontend Admin: http://localhost:8080
==============================================
```

在浏览器访问 **http://localhost:8080** 即可使用中后台。如需后台运行，使用 `docker compose up -d`。

**交付验证**：在项目根目录执行 `docker compose up --build`，看到上述 "Startup Success" 与访问地址后，用浏览器打开该地址即可验收各模块功能。

## 本地开发（不经过 Docker）

在项目根目录用任意静态服务器托管 `frontend-admin` 目录，例如：

```bash
cd frontend-admin && npx serve -p 3000
```

访问 http://localhost:3000（注意：部分功能依赖相对路径 `js/`、`css/`，请以根路径打开）。

## 功能概览

| 模块         | 说明 |
|--------------|------|
| 商家知识     | 按商家筛选，对该商家下知识增删改查（标准问、相似问、答案） |
| 商家集合知识 | 新建/编辑/删除商家集合（多选商家），在集合下管理知识 |
| 行业知识     | 新增/编辑/删除行业（二级行业），在行业下管理知识 |
| 通用知识     | 全局知识增删改查；商家黑名单（黑名单内商家不生效通用知识） |

## 技术栈

- HTML + JavaScript + CSS
- Tailwind CSS（CDN）
- 字体：Plus Jakarta Sans、Inter、JetBrains Mono
- 交付：Docker + Nginx

## 项目结构

```
label-01709/
├── .dockerignore        # 构建上下文排除，加速镜像构建
├── .gitignore
├── .sop                 # Alkaid-SOP 协议标识
├── README.md
├── Dockerfile           # 前端镜像构建
├── docker-compose.yml   # 编排与启动
├── entrypoint.sh        # 容器入口（输出启动信息并启动 Nginx）
├── docs/                # 项目文档
│   ├── DesignSpec.md    # 设计规范
│   ├── Requirements.md  # 需求说明
│   └── Roadmap.md       # 开发路线
└── frontend-admin/      # 运营端中后台
    ├── login.html       # 登录页面
    ├── index.html       # 首页/概览
    ├── global.html      # 通用知识 + 黑名单
    ├── merchant.html    # 商家知识
    ├── merchant-set.html # 商家集合知识
    ├── industry.html    # 行业知识
    ├── css/
    │   └── common.css   # 公共样式
    └── js/
        ├── app.js       # 应用框架（模块化工具类）
        ├── common.js    # 公共逻辑（导航、Toast、登录检查）
        ├── mock.js      # Mock 数据、存储、认证模块
        ├── tailwind-config.js # Tailwind 配置
        └── pages/       # 页面控制器模块
            ├── merchant.js     # 商家知识页面控制器
            ├── merchant-set.js # 商家集合页面控制器
            ├── industry.js     # 行业知识页面控制器
            └── global.js       # 通用知识页面控制器
```
