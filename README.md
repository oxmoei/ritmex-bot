# ritmex-bot

一个基于 Bun 的 Aster 永续合约终端机器人，内置趋势跟随（SMA30）与做市策略，使用 websocket 实时行情，命令行界面由 Ink 驱动，可在断线后自动恢复运行。

## 💁‍♀️ 快速上手

使用优惠码获取 30% 手续费折扣：[注册 Aster 获取手续费优惠](https://www.asterdex.com/zh-CN/referral/5e0897)

如果你完全不懂代码，可以查看 **[小白教程](simple-readme.md) 了解使用方法。**

遇到Bug，反馈问题，请到 [Telegram群组](https://t.me/+4fdo0quY87o4Mjhh)

## 🖥️ **支持平台**
- ![macOS](https://img.shields.io/badge/-macOS-000000?logo=apple&logoColor=white)
- ![Linux](https://img.shields.io/badge/-Linux-FCC624?logo=linux&logoColor=black)

## 🤖 安装/运行（macOS/Linux/WSL）
### -确保你已安装 `git`，如果未安装请参考➡️[安装git教程](./安装git教程.md)）
1. **克隆仓库并进入项目目录**
     ```bash
     git clone https://github.com/oxmoei/ritmex-bot.git && cd ritmex-bot 
     ```
2. **自动安装依赖和配置环境**
     ```bash
     chmod +x setup.sh && ./setup.sh
     ```
3. **风险提示**
   建议先在小额或仿真环境中测试策略；真实资金操作前请确认 API 仅开启必要权限，并逐步验证配置。

