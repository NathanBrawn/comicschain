MiniComic Frontend (测试网)

环境变量
- WEB3_STORAGE_TOKEN: 用于 IPFS 上传（web3.storage）

安装与启动
```
cd action/mini-comic-hardhat
npm install
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat deploy --network sepolia

cd ../mini-comic-frontend
npm install
npm run genabi
WEB3_STORAGE_TOKEN=xxxx npm run dev
```

页面
- /create: 上传封面与漫画页，生成 metadata 并铸造
- /comic/[id]: 作品详情与购买按钮
- /reader/[id]: 阅读器




