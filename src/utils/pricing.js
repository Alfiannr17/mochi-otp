// src/utils/pricing.js
export const calculateMochiPrice = (serviceCode, originalPrice) => {
  const specialServices = ['wa', 'tg', 'tele', 'whatsapp', 'telegram'];
  const basePrice = Math.ceil(Number(originalPrice) * 18000);

  if (specialServices.includes(serviceCode.toLowerCase())) {
    return basePrice + 1000;
  }
  return basePrice + 600;
};
