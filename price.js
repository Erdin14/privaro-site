// Shows Privaro Pro's price as the visitor's App Store would. Their country
// is guessed here in the browser, from the time zone and then the language
// settings; nothing is sent anywhere. build.py fills in DATA from
// i18n/prices.json and i18n/timezones.json.
(() => {
  const DATA = {"base":"NL","lang":{"en":"US","es":"ES","fr":"FR","de":"DE","it":"IT","pt-BR":"BR","zh-Hans":"CN","ko":"KR","nl":"NL"},"zones":{"Europe/Amsterdam":"NL"},"prices":{"NL":["EUR",11.99]}};
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

  const [currency, amount] = DATA.prices[country()];
  function format(n) {
    const opts = { style: 'currency', currency, currencyDisplay: 'narrowSymbol' };
    if (n % 1 === 0) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = 0; }
    try { return new Intl.NumberFormat(lang, opts).format(n); }
    catch (e) { opts.currencyDisplay = 'symbol'; return new Intl.NumberFormat(lang, opts).format(n); }
  }
  for (const el of spans) {
    const text = format(el.dataset.price === 'free' ? 0 : amount);
    if (el.textContent !== text) el.textContent = text;
  }
})();
