// src/components/MochiButton.jsx
export default function MochiButton({ children, onClick, className = '', ...props }) {
  return (
    <button 
      {...props}
      onClick={onClick}
      className={`w-full bg-mochi-green border-2 border-black rounded-xl py-3 font-bold text-lg shadow-neo active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all ${className}`}
    >
      {children}
    </button>
  );
}
