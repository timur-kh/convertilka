// Настройки сайта. Всё, что нужно поменять владельцу, — здесь.

export const CONFIG = {
  siteName: 'Конвертилка',

  // Ссылки на страницы для пожертвований. Пустые ссылки не показываются.
  donate: {
    boosty: '',          // например 'https://boosty.to/yourname/donate'
    kofi: '',            // например 'https://ko-fi.com/yourname'
    other: '',           // любая другая ссылка (ЮMoney, DonationAlerts, Patreon…)
    contactEmail: '',    // куда писать, если код не пришёл
    // Сколько дней без рекламы даёт один код (указывается при выпуске кода, тут — только для текста на сайте)
    adFreeDays: 30,
  },

  // Открытый ключ для проверки кодов «без рекламы» (ECDSA P-256, JWK).
  // Сгенерируйте свой: node tools/supporter-keygen.mjs — и вставьте сюда вывод.
  // Пока null — ввод кодов на сайте отключён.
  supporterPublicKey: null,

  // Реклама. По умолчанию выключена: пока enabled=false, на сайт не грузится ни один сторонний скрипт.
  // ВАЖНО: при включении нужно расширить Content-Security-Policy в <meta> каждой HTML-страницы (см. README.md).
  ads: {
    enabled: false,
    provider: 'yandex', // 'yandex' (РСЯ) или 'adsense'
    yandex: {
      // ID блоков из кабинета РСЯ, по одному на каждое место на странице
      blocks: { top: '', side: '', bottom: '' }, // например 'R-A-1234567-1'
    },
    adsense: {
      client: '', // 'ca-pub-XXXXXXXXXXXXXXXX'
      slots: { top: '', side: '', bottom: '' },
    },
  },

  // Файлы больше этого размера принимаются, но с предупреждением (браузер может не потянуть).
  warnFileSizeMB: 300,
};
