import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const fieldLabels = {
  student_name: 'Student name',
  company_name: 'Company name',
  internship_role: 'Internship role',
  start_date: 'Start date',
  end_date: 'End date',
  certificate_number: 'Certificate number',
  verification_url: 'Verification URL',
};

function App() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState(null);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!file) return;

    const body = new FormData();
    body.append('file', file);
    setMessage('Uploading certificate and searching for QR codes or verification links…');
    setDetails(null);
    setVerification(null);

    try {
      const response = await fetch('http://localhost:8000/api/certificates/upload', {
        method: 'POST',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Upload failed');
      setMessage(`Received: ${result.filename}`);
      setDetails(result);
    } catch (error) {
      setMessage(error.message || 'Upload failed. Is the API running on port 8000?');
    }
  }

  async function verifyCertificate() {
    if (!details?.certificate_id) return;
    setVerifying(true);
    setVerification(null);

    try {
      const response = await fetch(`http://localhost:8000/api/certificates/${details.certificate_id}/verify`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Verification failed');
      setVerification(result);
    } catch (error) {
      setVerification({ status: 'verification_unavailable', message: error.message });
    } finally {
      setVerifying(false);
    }
  }

  const sources = details?.verification_sources || [];
  const canVerify = sources.length > 0;

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">College internship operations</p>
        <h1>InternVerify</h1>
        <p className="intro">Upload internship certificates, detect their verification source, and check the certificate online.</p>
      </header>
      <section className="panel">
        <h2>Upload a certificate</h2>
        <form onSubmit={submit}>
          <input type="file" accept="application/pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="submit" disabled={!file}>Upload certificate</button>
        </form>
        {message && <p className="message" role="status">{message}</p>}
        {details && (
          <div className="result" aria-live="polite">
            <h3>Certificate processing</h3>
            <p><strong>Status:</strong> <span className={`status ${details.status}`}>{String(details.status || '').replaceAll('_', ' ')}</span></p>
            <p><strong>Certificate ID:</strong> {details.certificate_id}</p>
            <p><strong>File size:</strong> {details.size_bytes} bytes</p>
            <p><strong>Extraction status:</strong> {details.next_step}</p>
            <p><strong>Note:</strong> {details.extraction_note}</p>

            <h3>Verification source</h3>
            {sources.length ? (
              <>
                <p className="success-note">A QR code or verification link was detected.</p>
                <ul className="source-list">
                  {sources.map((source, index) => (
                    <li key={`${source.url}-${index}`}>
                      <strong>{source.source_type === 'qr' ? 'QR code' : 'Printed link'}{source.page ? ` — page ${source.page}` : ''}</strong>
                      <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={verifyCertificate} disabled={verifying}>
                  {verifying ? 'Verifying certificate…' : 'Verify certificate'}
                </button>
              </>
            ) : (
              <p className="review-warning">No QR code or verification link was detected. This certificate cannot be automatically verified yet.</p>
            )}

            {verification && (
              <div className="verification-result">
                <h3>Verification result</h3>
                <p><strong>Status:</strong> <span className={`status ${verification.status}`}>{String(verification.status || '').replaceAll('_', ' ')}</span></p>
                {verification.message && <p>{verification.message}</p>}
                {verification.url && <p><strong>Checked URL:</strong> <a href={verification.url} target="_blank" rel="noreferrer">{verification.url}</a></p>}
                {verification.http_status && <p><strong>HTTP status:</strong> {verification.http_status}</p>}
              </div>
            )}

            {details.extracted_fields && (
              <details className="secondary-details">
                <summary>Show secondary extracted fields</summary>
                <div className="fields">
                  {Object.entries(fieldLabels).map(([key, label]) => (
                    <p key={key}><strong>{label}:</strong> {details.extracted_fields[key] || 'Not detected'}</p>
                  ))}
                </div>
              </details>
            )}

            {details.full_text && (
              <details className="raw-text">
                <summary>Show complete extracted text</summary>
                <pre className="text-preview">{details.full_text}</pre>
              </details>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
