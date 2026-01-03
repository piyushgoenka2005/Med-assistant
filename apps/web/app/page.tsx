import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p>Upload a prescription, review extraction, confirm cart, then pay.</p>
      <Link href="/upload">Go to Upload</Link>
    </div>
  );
}
