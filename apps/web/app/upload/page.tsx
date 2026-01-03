'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [dob, setDob] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [emailId, setEmailId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a file first');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('customerName', customerName);
      form.append('doctorName', doctorName);
      form.append('dob', dob);
      form.append('phoneNumber', phoneNumber);
      form.append('emailId', emailId);
      const res = await fetch(`${API_BASE}/v1/uploads/prescription`, {
        method: 'POST',
        body: form
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      router.push(`/prescriptions/${data.prescriptionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
      <label>
        Customer name:
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          style={{ display: 'block', marginTop: 8, width: '100%' }}
          placeholder="Full name"
        />
      </label>

      <label>
        Doctor name:
        <input
          value={doctorName}
          onChange={(e) => setDoctorName(e.target.value)}
          style={{ display: 'block', marginTop: 8, width: '100%' }}
          placeholder="Dr. ..."
        />
      </label>

      <label>
        DOB:
        <input
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          style={{ display: 'block', marginTop: 8 }}
        />
      </label>

      <label>
        Phone:
        <input
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          style={{ display: 'block', marginTop: 8, width: '100%' }}
          placeholder="+91..."
        />
      </label>

      <label>
        Email:
        <input
          value={emailId}
          onChange={(e) => setEmailId(e.target.value)}
          style={{ display: 'block', marginTop: 8, width: '100%' }}
          placeholder="name@example.com"
        />
      </label>

      <label>
        Prescription file (image/PDF):
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ display: 'block', marginTop: 8 }}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Uploading...' : 'Upload & Extract'}
      </button>
      {error ? <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{error}</pre> : null}
    </form>
  );
}
