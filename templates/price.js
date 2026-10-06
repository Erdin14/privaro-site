// Shows Privaro Pro's price as the visitor's App Store would. Their country
// is guessed here in the browser, from the time zone and then the language
// settings; nothing is sent anywhere. build.py fills in DATA from
// i18n/prices.json and i18n/timezones.json.
(() => {
  const DATA = /*DATA*/null;
  const spans = document.querySelectorAll('.price[data-price]');
  if (!DATA || !spans.length) return;
  const lang = document.documentElement.lang;
  const listed = cc => cc && Object.prototype.hasOwnProperty.call(DATA.prices, cc);

  function country() {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (listed(DATA.zones[zone])) return DATA.zones[zone];
    } catch (e) { /* no Intl time zone support: fall through */ }
    for (const tag of navigator.languages || [navigator.language]) {
      const region = /-([a-z]{2})(?:-|$)/i.exec(tag || '');
      if (region && listed(region[1].toUpperCase())) return region[1].toUpperCase();
    }
    return listed(DATA.lang[lang]) ? DATA.lang[lang] : DATA.base;
  }

  const cc = country();
  const [currency, amount] = DATA.prices[cc];
  // "$" is fine where it means the local dollar, but many storefronts charge
  // in US dollars where "$" means something else (pesos, in Argentina), so
  // those get the plain currency code.
  const display = currency === 'USD' && !DATA.usd.includes(cc) ? 'code' : 'narrowSymbol';
  function format(n) {
    const opts = { style: 'currency', currency, currencyDisplay: display };
    if (n % 1 === 0) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = 0; }
    try { return new Intl.NumberFormat(lang, opts).format(n); }
    catch (e) { opts.currencyDisplay = 'symbol'; return new Intl.NumberFormat(lang, opts).format(n); }
  }
  for (const el of spans) {
    const text = format(el.dataset.price === 'free' ? 0 : amount);
    if (el.textContent !== text) el.textContent = text;
  }
})();
