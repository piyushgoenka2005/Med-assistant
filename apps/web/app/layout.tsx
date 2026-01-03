export const metadata = {
  title: 'Medi Platform'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
          <h1 style={{ margin: '8px 0 16px' }}>Medi Platform (MVP)</h1>
          {children}
        </div>
      </body>
    </html>
  );
}
