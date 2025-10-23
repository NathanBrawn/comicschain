import http from "http";

function postJSON(url, body) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(res.statusCode === 200));
    });
    req.on("error", () => resolve(false));
    req.write(JSON.stringify(body));
    req.end();
  });
}

const ok = await postJSON("http://127.0.0.1:8545", { jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 });
if (!ok) {
  console.log("Hardhat node not running on 127.0.0.1:8545");
  process.exit(0);
}
console.log("Hardhat node is running.");




