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

  async function submit(event) {
    event.preventDefault();
    if (!file) return;

    const body = new FormData();
    body.append('file', file);
    setMessage('Uploading and extracting certificate fields…');
    setDetails(null);

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

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">College internship operations</p>
        <h1>InternVerify</h1>
        <p className="intro">Upload internship certificates and prepare them for automated verification.</p>
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
            <p><strong>Status:</strong> <span className={`status ${details.status}`}>{details.status.replaceAll('_', ' ')}</span></p>
            <p><strong>Certificate ID:</strong> {details.certificate_id}</p>
            <p><strong>File size:</strong> {details.size_bytes} bytes</p>
            <p><strong>Extraction status:</strong> {details.next_step}</p>
            <p><strong>Note:</strong> {details.extraction_note}</p>
            {details.missing_fields?.length > 0 && (
              <p className="review-warning"><strong>Needs review:</strong> Missing {details.missing_fields.map((key) => fieldLabels[key] || key).join(', ')}.</p>
            )}
            {details.extracted_fields && (
              <>
                <h3>Extracted certificate fields</h3>
                <div className="fields">
                  {Object.entries(fieldLabels).map(([key, label]) => (
                    <p key={key}><strong>{label}:</strong> {details.extracted_fields[key] || 'Not detected'}</p>
                  ))}
                </div>
              </>
            )}
            {details.text_preview && (
              <>
                <h3>Extracted text preview</h3>
                <pre className="text-preview">{details.text_preview}</pre>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
