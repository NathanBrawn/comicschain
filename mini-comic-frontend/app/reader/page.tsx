"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useSearchParams } from "next/navigation";
import { MiniComicRegistryABI } from "@/abi/MiniComicRegistryABI";
import { MiniComicRegistryAddresses } from "@/abi/MiniComicRegistryAddresses";

function ReaderInner() {
  const searchParams = useSearchParams();
  const tokenId = Number(searchParams?.get("id") || "0");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    setProvider(p);
    (async () => {
      await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      setSigner(s);
      const n = await p.getNetwork();
      setChainId(Number(n.chainId));
    })();
  }, []);

  const registry = useMemo(() => {
    if (!signer || chainId == null) return null;
    const info = MiniComicRegistryAddresses[String(chainId as number) as "11155111" | "31337"] || MiniComicRegistryAddresses["11155111"];
    return new ethers.Contract(info.address, MiniComicRegistryABI.abi, signer);
  }, [signer, chainId]);

  useEffect(() => {
    (async () => {
      if (!registry) return;
      const info = await registry.getComicInfo(tokenId);
      const uri: string = info[0];
      if (uri) {
        const res = await fetch(`/api/ipfs?uri=${encodeURIComponent(uri)}&as=json`);
        if (res.ok) {
          const j = await res.json();
          setMeta(j);
        }
      }
    })();
  }, [registry, tokenId]);

  const pages: string[] = meta?.pages || [];
  const max = pages.length;

  return (
    <main className="container">
      {!meta ? (
        <div className="muted">Loading...</div>
      ) : (
        <div className="viewer">
          {max > 0 ? (
            <>
              <img src={`/api/ipfs?cid=${encodeURIComponent(pages[page])}`}/>
              <div className="row">
                <button className="btn secondary" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
                <span className="pill">{page + 1} / {max}</span>
                <button className="btn" disabled={page >= max - 1} onClick={() => setPage((p) => Math.min(max - 1, p + 1))}>Next</button>
              </div>
            </>
          ) : (
            <div className="muted">No pages</div>
          )}
        </div>
      )}
    </main>
  );
}

export default function Reader() {
  return (
    <Suspense fallback={<div className="container"><div className="muted">Loading...</div></div>}>
      <ReaderInner />
    </Suspense>
  );
}

