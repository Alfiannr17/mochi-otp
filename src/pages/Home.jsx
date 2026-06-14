import { useNavigate } from 'react-router-dom';
import MochiButton from '../components/MochiButton';
import {
  CheckIcon,
  HistoryIcon,
  OrderIcon,
  SearchIcon,
  ServiceIcon,
  WalletIcon,
} from '../components/Icons';

const popularServices = ['WhatsApp', 'Telegram', 'Google', 'Facebook', 'TikTok', 'Instagram'];

const highlights = [
  { label: 'Multi Server', detail: 'Pilihan nomor lebih banyak', icon: OrderIcon },
  { label: 'Pantau OTP', detail: 'Order tersimpan di history', icon: HistoryIcon },
  { label: 'Top Up QRIS', detail: 'Deposit cepat dan praktis', icon: WalletIcon },
];

const orderSteps = [
  { number: '01', title: 'Pilih Layanan', detail: 'Cari negara dan aplikasi yang kamu butuhkan.' },
  { number: '02', title: 'Ambil Nomor', detail: 'Pilih stok nomor dengan harga yang sesuai.' },
  { number: '03', title: 'Terima OTP', detail: 'Pantau semua SMS langsung dari halaman order.' },
];

function MochiMoonBot() {
  return (
    <div className="relative w-32 h-32 shrink-0" aria-hidden="true">
      <div className="mochi-orbit">
        <span className="mochi-orbit-dot" />
      </div>
      <svg viewBox="0 0 180 180" className="w-full h-full overflow-visible">
        <g className="mochi-bot-float">
          <path
            d="M43 96C25 102 18 115 15 129"
            fill="none"
            stroke="#000"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <g className="mochi-wave-hand">
            <path
              d="M136 86C150 73 157 58 158 43M157 58C166 52 171 44 174 35M156 59C169 62 176 68 181 76"
              fill="none"
              stroke="#000"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="137" cy="85" r="8" fill="#D4FF00" stroke="#000" strokeWidth="5" />
          </g>
          <circle cx="91" cy="92" r="57" fill="#70D8FF" stroke="#000" strokeWidth="7" />
          <path
            d="M53 55C63 43 77 37 92 36C86 46 88 54 98 61C108 68 106 77 97 82C86 88 75 81 69 72C64 65 58 61 53 55Z"
            fill="#D4FF00"
            stroke="#000"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path
            d="M119 53C133 62 143 76 146 91C133 87 124 91 119 100C114 109 105 108 100 99C95 90 100 79 108 73C115 68 118 61 119 53Z"
            fill="#D4FF00"
            stroke="#000"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path
            d="M72 128C83 119 94 118 103 125C110 131 119 133 127 130C117 141 104 148 90 149C82 145 76 138 72 128Z"
            fill="#D4FF00"
            stroke="#000"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <circle cx="64" cy="94" r="7" fill="#A9ECFF" stroke="#000" strokeWidth="3" />
          <circle cx="127" cy="115" r="6" fill="#A9ECFF" stroke="#000" strokeWidth="3" />
          <circle cx="111" cy="42" r="5" fill="#A9ECFF" stroke="#000" strokeWidth="3" />
          <ellipse cx="76" cy="96" rx="7" ry="10" fill="#000" />
          <ellipse cx="109" cy="96" rx="7" ry="10" fill="#000" />
          <circle cx="78" cy="93" r="2.5" fill="#fff" />
          <circle cx="111" cy="93" r="2.5" fill="#fff" />
          <path
            d="M80 116C88 124 99 124 107 116"
            fill="none"
            stroke="#000"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <ellipse cx="64" cy="112" rx="8" ry="4" fill="#FF8E9E" />
          <ellipse cx="120" cy="112" rx="8" ry="4" fill="#FF8E9E" />
        </g>
      </svg>
      <span className="absolute top-2 left-5 text-xl font-black mochi-sparkle">*</span>
      <span className="absolute bottom-3 right-0 text-lg font-black mochi-sparkle-delay">+</span>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="pb-5">
      <section className="relative w-full border-2 border-black rounded-2xl bg-mochi-green shadow-neo mb-7 overflow-hidden">
        <div className="absolute inset-0 mochi-hero-grid opacity-30" />
        <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full border-2 border-black bg-white/40" />
        <div className="relative z-10 p-4">
          <div className="flex items-center gap-3">
            <MochiMoonBot />
            <div className="min-w-0">
              <p className="inline-block border-2 border-black rounded-md bg-white px-2 py-1 text-[9px] font-black uppercase shadow-neo mb-3">
                Instant OTP Service
              </p>
              <h1 className="text-3xl sm:text-4xl font-black leading-none tracking-tighter mb-2">
                MOCHI OTP
              </h1>
              <p className="text-xs sm:text-sm font-black uppercase leading-relaxed">
                Virtual Number
                <br />
                Cepat & Siap Pakai
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-2">
            <button
              type="button"
              onClick={() => navigate('/order')}
              className="border-2 border-white rounded-xl bg-black text-white py-3 px-2 font-black text-xs shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] active:translate-y-1 active:shadow-none"
            >
              MULAI ORDER
            </button>
            <button
              type="button"
              onClick={() => navigate('/deposit')}
              className="border-2 border-black rounded-xl bg-white py-3 px-2 font-black text-xs shadow-neo active:translate-y-1 active:shadow-none"
            >
              TOP UP SALDO
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2 mb-8">
        {highlights.map(({ label, detail, icon: Icon }) => (
          <div key={label} className="min-w-0 border-2 border-black rounded-xl bg-white p-2.5 shadow-neo">
            <div className="w-8 h-8 border-2 border-black rounded-lg bg-mochi-green flex items-center justify-center mb-2">
              <Icon className="w-4 h-4" />
            </div>
            <h2 className="text-[10px] font-black leading-tight mb-1">{label}</h2>
            <p className="text-[8px] font-bold leading-tight text-gray-600">{detail}</p>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <div className="flex justify-between items-end gap-3 mb-4">
          <div>
            <p className="text-[9px] font-black uppercase text-purple-600 mb-1">Pilih lebih cepat</p>
            <h2 className="text-xl font-black leading-none">Layanan Populer</h2>
          </div>
          <button
            type="button"
            onClick={() => navigate('/order')}
            className="shrink-0 text-[10px] font-black underline underline-offset-4"
          >
            Lihat semua
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {popularServices.map((service, index) => (
            <button
              key={service}
              type="button"
              onClick={() => navigate(`/order?service=${encodeURIComponent(service)}`)}
              className={`relative min-w-0 border-2 border-black rounded-xl shadow-neo p-3 flex flex-col items-center active:translate-y-1 active:shadow-none transition-all ${
                index === 0 ? 'bg-mochi-green' : 'bg-white'
              }`}
            >
              {index < 3 && (
                <span className="absolute top-1.5 right-1.5 border border-black rounded bg-black text-white px-1.5 py-0.5 text-[7px] font-black">
                  TOP
                </span>
              )}
              <ServiceIcon label={service} className="mb-2 bg-white" />
              <span className="w-full truncate text-[10px] font-black text-center">{service}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="border-2 border-black rounded-2xl bg-white shadow-neo p-4 mb-8">
        <div className="flex items-center gap-3 border-b-2 border-black pb-3 mb-4">
          <div className="w-10 h-10 border-2 border-black rounded-full bg-mochi-green flex items-center justify-center">
            <SearchIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-gray-500">Mudah digunakan</p>
            <h2 className="text-lg font-black">Cara Pesan Nomor</h2>
          </div>
        </div>

        <div className="space-y-3">
          {orderSteps.map((step, index) => (
            <div key={step.number} className="flex gap-3 items-start">
              <div className="w-9 h-9 shrink-0 border-2 border-black rounded-lg bg-mochi-bg flex items-center justify-center font-black text-xs">
                {step.number}
              </div>
              <div className={`flex-1 pb-3 ${index < orderSteps.length - 1 ? 'border-b-2 border-dashed border-black' : ''}`}>
                <h3 className="font-black text-xs mb-1">{step.title}</h3>
                <p className="text-[10px] font-bold text-gray-600 leading-relaxed">{step.detail}</p>
              </div>
              <CheckIcon className="w-4 h-4 shrink-0 mt-1" />
            </div>
          ))}
        </div>
      </section>

      <section className="relative border-2 border-black rounded-2xl bg-black text-white shadow-[4px_4px_0px_0px_#D4FF00] p-5 overflow-hidden">
        <div className="absolute -right-5 -bottom-8 w-28 h-28 border-2 border-white rounded-full opacity-20" />
        <div className="relative z-10">
          <p className="text-[9px] font-black uppercase text-mochi-green mb-2">Nomor siap digunakan</p>
          <h2 className="text-xl font-black mb-2">Mulai terima OTP sekarang.</h2>
          <p className="text-[10px] font-bold text-gray-300 mb-4 max-w-xs">
            Pilih server, negara, layanan, lalu pantau SMS langsung dari satu tempat.
          </p>
          <MochiButton onClick={() => navigate('/order')} className="text-sm py-2.5 text-black">
            Order OTP Sekarang
          </MochiButton>
        </div>
      </section>
    </div>
  );
}
