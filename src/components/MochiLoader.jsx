export default function MochiLoader({
  message = '',
  fullScreen = false,
  compact = false,
  className = '',
}) {
  return (
    <div
      role="status"
      aria-label={message || 'Memuat Mochi OTP'}
      className={`mochi-loader ${fullScreen ? 'mochi-loader-fullscreen' : ''} ${compact ? 'mochi-loader-compact' : ''} ${className}`}
    >
      <div className="mochi-loader-content">
        <p className="mochi-loader-title">Mochi OTP</p>
        <div className="mochi-loader-track" aria-hidden="true">
          <div className="mochi-loader-progress" />
        </div>
        {message && <p className="mochi-loader-message">{message}</p>}
      </div>
    </div>
  );
}

