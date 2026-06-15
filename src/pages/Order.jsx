import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import WebApp from '../lib/telegram';
import MochiButton from '../components/MochiButton';
import { ArrowLeftIcon, SearchIcon, ServiceIcon } from '../components/Icons';
import { useMochiDialog } from '../hooks/useMochiDialog';
import { supabase } from '../lib/supabase';
import { sanitizePublicError } from '../lib/publicError';
import { fetchUserData } from '../lib/userData';
import { normalizeFeatureSettings } from '../lib/featureSettings';
import MochiLoader from '../components/MochiLoader';

const providers = [
  { id: 'smsbower', featureKey: 'server1', name: 'Server 1' },
  { id: 'smscode', featureKey: 'server2', name: 'Server 2' },
];

const getFunctionErrorMessage = async (error, fallback) => {
  try {
    const payload = await error?.context?.json();
    return sanitizePublicError(payload?.error || payload?.message || error?.message, fallback);
  } catch {
    return sanitizePublicError(error?.message, fallback);
  }
};

export default function Order() {
  const navigate = useNavigate();
  const dialog = useMochiDialog();
  const [searchParams] = useSearchParams();
  const initialService = searchParams.get('service') || '';
  const tgUser = WebApp.initDataUnsafe?.user;
  const userId = tgUser?.id;

  const [userBalance, setUserBalance] = useState(0);
  const [step, setStep] = useState('select');
  const [selectedProvider, setSelectedProvider] = useState(providers[0]);
  const [featureSettings, setFeatureSettings] = useState(() => normalizeFeatureSettings());
  const [countries, setCountries] = useState([]);
  const [services, setServices] = useState([]);
  const [searchCountry, setSearchCountry] = useState('');
  const [searchService, setSearchService] = useState(initialService);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [products, setProducts] = useState([]);
  const [showAllServices, setShowAllServices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    const loadInitialData = async () => {
      const [userResult, featuresResult] = await Promise.all([
        supabase.from('users').select('balance').eq('id', userId).single(),
        fetchUserData('features').catch(() => null),
      ]);

      if (!active) return;

      if (userResult.data) setUserBalance(Number(userResult.data.balance || 0));
      const nextFeatureSettings = normalizeFeatureSettings(featuresResult?.features);
      const availableProvider = providers.find(
        (provider) => nextFeatureSettings[provider.featureKey].is_active,
      );
      setFeatureSettings(nextFeatureSettings);

      if (!availableProvider) {
        setSelectedProvider(providers[0]);
        setCountries([]);
        setServices([]);
        setErrorMessage('Semua server sedang maintenance. Silakan coba lagi nanti.');
        setLoading(false);
        return;
      }

      setSelectedProvider(availableProvider);
      const { data, error } = await supabase.functions.invoke('sms-catalog', {
        body: { action: 'getCatalog', provider: availableProvider.id },
      });
      if (!active) return;

      if (error || !data?.success) {
        setErrorMessage(
          (data?.error && sanitizePublicError(data.error, 'Katalog layanan gagal dimuat.')) ||
          await getFunctionErrorMessage(error, 'Katalog layanan gagal dimuat.'),
        );
      } else {
        setCountries(data.countries || []);
        setServices(data.services || []);
      }

      setLoading(false);
    };

    loadInitialData();
    return () => {
      active = false;
    };
  }, [userId]);

  const filteredCountries = useMemo(() => {
    const query = searchCountry.trim().toLowerCase();
    if (!query) return [];
    return countries
      .filter((country) => country.name.toLowerCase().includes(query))
      .slice(0, 50);
  }, [countries, searchCountry]);

  const filteredServices = useMemo(() => {
    const query = searchService.trim().toLowerCase();
    if (!query) return services;
    return services.filter((service) => service.name.toLowerCase().includes(query));
  }, [services, searchService]);

  const visibleServices = showAllServices ? filteredServices : filteredServices.slice(0, 6);

  const handleSelectProvider = async (provider) => {
    if (!featureSettings[provider.featureKey].is_active) return;
    if (loading || provider.id === selectedProvider.id) return;

    setSelectedProvider(provider);
    setLoading(true);
    setErrorMessage('');
    setCountries([]);
    setServices([]);
    setProducts([]);
    setSelectedCountry(null);
    setSelectedService(null);
    setSearchCountry('');
    setSearchService('');
    setShowAllServices(false);

    const { data, error } = await supabase.functions.invoke('sms-catalog', {
      body: { action: 'getCatalog', provider: provider.id },
    });

    if (error || !data?.success) {
      setErrorMessage(
        (data?.error && sanitizePublicError(data.error, 'Katalog layanan gagal dimuat.')) ||
        await getFunctionErrorMessage(error, 'Katalog layanan gagal dimuat.'),
      );
    } else {
      setCountries(data.countries || []);
      setServices(data.services || []);
    }

    setLoading(false);
  };

  const handleContinue = async () => {
    if (!selectedService || loading) return;
    if (!featureSettings[selectedProvider.featureKey].is_active) {
      await dialog.alert(featureSettings[selectedProvider.featureKey].maintenance_message, {
        title: 'Server Maintenance',
        type: 'error',
      });
      return;
    }

    setStep('products');
    setLoading(true);
    setErrorMessage('');
    setProducts([]);

    const { data, error } = await supabase.functions.invoke('sms-catalog', {
      body: {
        action: 'getPrices',
        provider: selectedProvider.id,
        serviceCode: selectedService.code,
        serviceId: selectedService.id,
        countryId: selectedCountry?.id,
      },
    });

    if (error || !data?.success) {
      setErrorMessage(
        (data?.error && sanitizePublicError(data.error, 'Harga dan stok gagal dimuat.')) ||
        await getFunctionErrorMessage(error, 'Harga dan stok gagal dimuat.'),
      );
    } else {
      const sortedProducts = [...(data.products || [])].sort(
        (a, b) =>
          Number(a.mochiPrice) - Number(b.mochiPrice) ||
          Number(a.basePrice) - Number(b.basePrice),
      );
      setProducts(sortedProducts);
    }

    setLoading(false);
  };

  const handleBuyProduct = async (product) => {
    if (userBalance < Number(product.mochiPrice)) {
      await dialog.alert('Saldo tidak cukup. Silakan top up terlebih dahulu.', {
        title: 'Saldo Tidak Cukup',
        type: 'error',
      });
      navigate('/deposit');
      return;
    }

    const agreed = await dialog.confirm(
      `Order ${product.serviceName} (${product.countryName}) seharga Rp${Number(product.mochiPrice).toLocaleString('id-ID')}?`,
      { title: 'Konfirmasi Order', confirmText: 'Order' },
    );
    if (!agreed) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('buy-number', {
        body: {
          userId,
          provider: selectedProvider.id,
          serviceCode: product.serviceCode,
          serviceId: product.serviceId,
          countryId: product.countryId,
          serviceName: product.serviceName,
          basePrice: product.basePrice,
          productId: product.productId,
          catalogProductId: product.catalogProductId,
        },
      });

      if (error) throw new Error(await getFunctionErrorMessage(error, 'Gagal mengambil nomor.'));
      if (data?.error) throw new Error(sanitizePublicError(data.error, 'Gagal mengambil nomor.'));

      WebApp.HapticFeedback?.notificationOccurred('success');
      navigate(`/orders/${data.order.id}`, { state: { order: data.order } });
    } catch (error) {
      await dialog.alert(sanitizePublicError(error.message, 'Gagal mengambil nomor.'), {
        title: 'Order Gagal',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  if (step === 'products') {
    return (
      <div className="pb-8">
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => setStep('select')}
            className="border-2 border-black rounded bg-white p-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none"
          >
            <ArrowLeftIcon className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-black truncate">{selectedService?.name}</h1>
        </div>
        <p className="text-xs mb-6 font-bold text-gray-600">
          {selectedCountry ? `Nomor tersedia untuk ${selectedCountry.name}.` : 'Menampilkan nomor dari semua negara.'}
        </p>

        {errorMessage && (
          <div className="mb-4 border-2 border-black rounded-xl bg-red-300 p-3 font-bold text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {errorMessage}
          </div>
        )}

        {loading ? (
          <MochiLoader compact message="Mencari stok nomor..." />
        ) : products.length === 0 ? (
          <div className="border-2 border-black p-6 rounded-xl bg-white text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] font-black mb-8">
            Maaf, stok nomor untuk layanan ini sedang kosong.
          </div>
        ) : (
          <div className="space-y-4 mb-8">
            {products.map((product) => (
              <div
                key={`${selectedProvider.id}-${product.catalogProductId || product.serviceCode}-${product.countryId}-${product.basePrice}`}
                className="border-2 border-black rounded-xl bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 flex justify-between items-center gap-3"
              >
                <div className="min-w-0">
                  <h3 className="font-black text-sm uppercase tracking-tight truncate">{product.serviceName} - {product.countryName}</h3>
                  <div className="flex flex-wrap items-baseline gap-2 mt-1">
                    <span className="text-xl font-black text-purple-600">Rp.{Number(product.mochiPrice).toLocaleString('id-ID')}</span>
                    <span className="text-[10px] font-bold bg-black text-white px-2 py-0.5 rounded">Stok: {product.stock}</span>
                    <span className="text-[10px] font-bold border-2 border-black px-2 py-0.5 rounded">{selectedProvider.name}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleBuyProduct(product)}
                  className="shrink-0 bg-mochi-green border-2 border-black rounded-lg px-4 py-2 font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all"
                >
                  Order
                </button>
              </div>
            ))}
          </div>
        )}

        <MochiButton onClick={() => setStep('select')}>Kembali</MochiButton>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <div className="flex justify-between items-start gap-3 mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pilih Layananmu!</h1>
      </div>
      <p className="text-xs mb-6 font-bold text-gray-600">
        Pilih server, negara, dan layanan untuk mulai menerima OTP.
      </p>

      <div className="mb-6">
        <label className="text-sm font-semibold block mb-2">Pilih Server</label>
        <div className="grid grid-cols-2 border-2 border-black rounded-xl overflow-hidden shadow-neo">
          {providers.map((provider, index) => (
            <button
              type="button"
              key={provider.id}
              onClick={() => handleSelectProvider(provider)}
              disabled={loading || !featureSettings[provider.featureKey].is_active}
              className={`py-3 px-2 text-lg font-black transition-colors disabled:opacity-60 ${
                index === 0 ? 'border-r-2 border-black' : ''
              } ${
                !featureSettings[provider.featureKey].is_active
                  ? 'bg-red-200'
                  : selectedProvider.id === provider.id
                    ? 'bg-mochi-green'
                    : 'bg-white'
              }`}
            >
              <span className="block">{provider.name}</span>
              <span className="block text-[9px] uppercase">
                {featureSettings[provider.featureKey].is_active ? 'Aktif' : 'Maintenance'}
              </span>
            </button>
          ))}
        </div>
        {providers.filter((provider) => !featureSettings[provider.featureKey].is_active).map((provider) => (
          <div key={`${provider.id}-maintenance`} className="mt-3 border-2 border-black rounded-xl bg-red-200 p-3 shadow-neo">
            <p className="text-xs font-black">{provider.name} Maintenance</p>
            <p className="mt-1 text-[11px] font-bold">{featureSettings[provider.featureKey].maintenance_message}</p>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <label className="text-sm font-semibold block mb-2">Pilih Negara</label>
        {selectedCountry && (
          <button
            type="button"
            onClick={() => setSelectedCountry(null)}
            className="mb-2 bg-mochi-green border-2 border-black rounded-full px-3 py-1 text-xs font-black shadow-neo"
          >
            {selectedCountry.name} x
          </button>
        )}
        <div className="relative">
          <input
            type="search"
            placeholder="Cari Negara..."
            value={searchCountry}
            onChange={(event) => setSearchCountry(event.target.value)}
            className="w-full border-2 border-black rounded-xl py-3 px-4 pr-12 font-bold shadow-neo outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all"
          />
          <span className="absolute right-4 top-3.5"><SearchIcon /></span>
        </div>
        {searchCountry.trim() && (
          <div className="mt-2 border-2 border-black bg-white rounded-xl shadow-neo max-h-48 overflow-y-auto">
            {filteredCountries.length > 0 ? filteredCountries.map((country) => (
              <button
                type="button"
                key={country.id}
                onClick={() => {
                  setSelectedCountry(country);
                  setSearchCountry('');
                }}
                className="block w-full text-left p-3 border-b-2 border-black last:border-b-0 font-bold text-sm hover:bg-mochi-green"
              >
                {country.name}
              </button>
            )) : (
              <p className="p-3 text-sm font-bold">Negara tidak ditemukan.</p>
            )}
          </div>
        )}
      </div>

      <div className="mb-6">
        <label className="text-sm font-semibold block mb-2">Pilih Layanan</label>
        <div className="relative">
          <input
            type="search"
            placeholder="Cari Layanan..."
            value={searchService}
            onChange={(event) => {
              setSearchService(event.target.value);
              setSelectedService(null);
              setShowAllServices(false);
            }}
            className="w-full border-2 border-black rounded-xl py-3 px-4 pr-12 font-bold shadow-neo outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all"
          />
          <span className="absolute right-4 top-3.5"><SearchIcon /></span>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-4 border-2 border-black rounded-xl bg-red-300 p-3 font-bold text-sm shadow-neo">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <MochiLoader compact message="Memuat layanan..." />
      ) : filteredServices.length === 0 ? (
        <div className="border-2 border-black rounded-xl bg-white p-6 text-center font-black shadow-neo mb-6">
          Layanan tidak ditemukan.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-5">
            {visibleServices.map((service) => (
              <button
                type="button"
                key={`${service.id || ''}-${service.code}`}
                onClick={() => setSelectedService(service)}
                className={`border-2 border-black rounded-xl shadow-neo p-3 min-h-28 flex flex-col items-center justify-center active:translate-y-1 active:shadow-none transition-all ${
                  selectedService?.code === service.code ? 'bg-mochi-green' : 'bg-white hover:bg-mochi-bg'
                }`}
              >
                <ServiceIcon label={service.name} className="mb-2 bg-white" />
                <span className="text-[11px] font-black text-center leading-tight line-clamp-2 w-full">{service.name}</span>
              </button>
            ))}
          </div>

          {filteredServices.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllServices((value) => !value)}
              className="block mx-auto mb-6 font-black text-sm underline underline-offset-4"
            >
              {showAllServices ? 'Lebih sedikit' : 'Lihat lainnya'}
            </button>
          )}
        </>
      )}

      <div className="fixed left-0 right-0 bottom-[90px] z-40 bg-mochi-bg p-1">
        <MochiButton
          onClick={handleContinue}
          disabled={!selectedService || loading || !featureSettings[selectedProvider.featureKey].is_active}
          className="disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Lanjutkan
        </MochiButton>
      </div>
    </div>
  );
}
