import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="navbar">
          <div className="row">
            <div className="brand">MiniComic</div>
            <span className="pill">FHEVM</span>
          </div>
          <div className="toolbar">
            <a className="btn secondary" href={(process.env.NEXT_PUBLIC_BASE_PATH || "") + "/"}>Home</a>
            <a className="btn" href={(process.env.NEXT_PUBLIC_BASE_PATH || "") + "/create"}>Create</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}


