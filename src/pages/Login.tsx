export default function Login({ onSignIn, error }: { onSignIn: () => void; error?: string }) {
  return (
    <div className="auth">
      <div className="card auth-card">
        <h1>Relationship Tracker</h1>
        <p className="muted">Sign in with your organization's Microsoft account. You will see the tracker if its folder has been shared with you.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block ms" onClick={onSignIn}>
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
            <rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
