// Настройки сайта. Всё, что нужно поменять владельцу, — здесь.

export const CONFIG = {
  siteName: 'Конвертилка',

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
