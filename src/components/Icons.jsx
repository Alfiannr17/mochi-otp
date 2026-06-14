function IconBase({ children, className = 'w-5 h-5', viewBox = '0 0 24 24' }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox={viewBox}
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props) {
  return <IconBase {...props}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></IconBase>;
}

export function OrderIcon(props) {
  return <IconBase {...props}><path d="M6 3h12l2 6H4l2-6Z" /><path d="M5 9v11h14V9" /><path d="M9 13h6" /></IconBase>;
}

export function HistoryIcon(props) {
  return <IconBase {...props}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></IconBase>;
}

export function WalletIcon(props) {
  return <IconBase {...props}><path d="M4 6h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13" /><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z" /></IconBase>;
}

export function UserIcon(props) {
  return <IconBase {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></IconBase>;
}

export function SearchIcon(props) {
  return <IconBase {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></IconBase>;
}

export function ArrowLeftIcon(props) {
  return <IconBase {...props}><path d="m15 18-6-6 6-6" /></IconBase>;
}

export function CopyIcon(props) {
  return <IconBase {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></IconBase>;
}

export function CheckIcon(props) {
  return <IconBase {...props}><path d="m5 12 4 4L19 6" /></IconBase>;
}

export function GiftIcon(props) {
  return <IconBase {...props}><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M12 9v12M3 13h18M7.5 9C5 9 4 7.8 4 6.5S5 4 6.5 4C9 4 12 9 12 9s3-5 5.5-5C19 4 20 5.2 20 6.5S19 9 16.5 9" /></IconBase>;
}

export function DashboardIcon(props) {
  return <IconBase {...props}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></IconBase>;
}

export function UsersIcon(props) {
  return <IconBase {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></IconBase>;
}

export function MenuIcon(props) {
  return <IconBase {...props}><path d="M4 6h16M4 12h16M4 18h16" /></IconBase>;
}

export function CloseIcon(props) {
  return <IconBase {...props}><path d="M18 6 6 18M6 6l12 12" /></IconBase>;
}

export function ServiceIcon({ label = '?', className = '' }) {
  return (
    <div className={`w-12 h-12 border-4 border-black rounded-full bg-mochi-green flex items-center justify-center font-black text-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] uppercase ${className}`}>
      {label.trim().charAt(0) || '?'}
    </div>
  );
}
