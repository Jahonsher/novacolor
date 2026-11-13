import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Lang, Localized } from './data'

const dict = {
  uz: {
    'nav.home': 'Bosh sahifa',
    'nav.products': 'Mahsulotlar',
    'nav.about': 'Biz haqimizda',
    'nav.news': 'Yangiliklar',
    'nav.contact': 'Aloqa',
    menu: 'Menyu',
    close: 'Yopish',
    tagline: 'I colori dell’Architettura',
    'hero.title': 'Biz tabiatga tegishlimiz',
    'hero.sub': 'Italiyaning dekorativ devor qoplamalari. Forli, 1982.',
    'hero.scroll': 'Pastga aylantiring',
    'hero.location': 'Toshkent · Yunusobod',
    'about.label': 'Novacolor haqida',
    'about.title': 'Italiya tarixi',
    'about.more': 'Batafsil',
    'cats.label': 'Mashhur kategoriyalar',
    'cats.hint': 'Aylantiring — kategoriyalar aylanadi',
    'cats.open': 'Ochish',
    'cats.products': 'mahsulot',
    'stats.label': 'Raqamlarda',
    'featured.label': 'Tanlangan mahsulotlar',
    'featured.title': 'Faktura. Yorug‘lik. Material.',
    'all.products': 'Barcha mahsulotlar',
    details: 'Batafsil',
    view: 'Ko‘rish',
    'news.label': 'Yangiliklar',
    'news.title': 'So‘nggi yangiliklar',
    'news.all': 'Barcha yangiliklar',
    'clients.label': 'Bizning mijozlar',
    'cta.label': 'Biz bilan bog‘laning',
    'cta.title': 'Devoringizga Italiya ruhini olib kiramiz',
    'cta.button': 'Xabar qoldiring',
    'footer.text': 'Novacolor 1982-yilda Italiyaning Forli shahrida tug‘ilgan.',
    'footer.links': 'Foydali linklar',
    'footer.contact': 'Aloqa',
    'footer.rights': 'Barcha huquqlar himoyalangan',
    'footer.top': 'Yuqoriga',
    'products.title': 'Mahsulotlar',
    'products.intro': 'Metall effektlar, mineral shtukaturkalar, oksidlanish, beton art va mat bo‘yoqlar — interyer va eksteryer uchun to‘liq Novacolor kolleksiyasi.',
    'products.all': 'Hammasi',
    'products.count': 'ta mahsulot',
    'product.category': 'Kategoriya',
    'product.description': 'Tavsif',
    'product.gallery': 'Fakturalar va interyerlar',
    'product.consult': 'Bu mahsulot bo‘yicha maslahat oling',
    'product.next': 'Keyingi mahsulot',
    'product.back': 'Barcha mahsulotlar',
    'docs.label': 'Sertifikatlar va hujjatlar',
    'docs.title': 'Sifat hujjatlarda',
    'docs.company': 'Kompaniya sertifikatlari',
    'docs.product': 'Mahsulot sertifikatlari',
    'docs.epd': 'Ekologik deklaratsiyalar (EPD)',
    'docs.note': 'Hujjatlar asl nusxada — ingliz yoki italyan tilida.',
    'about.page.label': 'Biz haqimizda',
    'about.milestone1': 'Forli shahrida, Italiyaning eng samarali mintaqalaridan birining markazida tashkil topdi.',
    'about.milestone2': 'Venetsiyalik San Marco Group tarkibiga kirdi va guruhning dekorativ pardozlash bo‘yicha yetakchi brendiga aylandi.',
    'about.values.label': 'Nimaga e’tibor beramiz',
    'about.value1': 'Sezgi',
    'about.value2': 'Ijodkorlik',
    'about.value3': 'Sifatli xom ashyo',
    'news.page.title': 'Yangiliklar',
    'news.page.intro': 'Novacolor kolleksiyasidagi yangi fakturalar va mahsulotlar.',
    'news.read': 'Mahsulotni ko‘rish',
    'contact.label': 'Biz bilan bog‘laning',
    'contact.title': 'Bizga xabar qoldiring',
    'contact.name': 'Ism',
    'contact.phone': 'Telefon',
    'contact.message': 'Xabar',
    'contact.send': 'Yuborish',
    'contact.sending': 'Yuborilmoqda…',
    'contact.sent': 'Rahmat! Xabaringiz yuborildi. Tez orada bog‘lanamiz.',
    'contact.copied': 'Xabaringiz nusxalandi. Telegram ochildi — uni @novacolor_uz ga yuboring.',
    'contact.error': 'Yuborib bo‘lmadi. Iltimos, telefon orqali bog‘laning.',
    'contact.address': 'Manzil',
    'contact.email': 'Email',
    'contact.socials': 'Ijtimoiy tarmoqlar',
    'contact.product': 'Mahsulot',
    'notfound.title': 'Sahifa topilmadi',
    'notfound.back': 'Bosh sahifaga qaytish',
    'month.12': 'dekabr',
  },
  ru: {
    'nav.home': 'Главная',
    'nav.products': 'Продукты',
    'nav.about': 'О нас',
    'nav.news': 'Новости',
    'nav.contact': 'Контакты',
    menu: 'Меню',
    close: 'Закрыть',
    tagline: 'I colori dell’Architettura',
    'hero.title': 'Мы принадлежим природе',
    'hero.sub': 'Итальянские декоративные покрытия для стен. Форли, 1982.',
    'hero.scroll': 'Листайте вниз',
    'hero.location': 'Ташкент · Юнусабад',
    'about.label': 'О Novacolor',
    'about.title': 'Итальянская история',
    'about.more': 'Подробнее',
    'cats.label': 'Популярные категории',
    'cats.hint': 'Листайте — категории вращаются',
    'cats.open': 'Открыть',
    'cats.products': 'продуктов',
    'stats.label': 'В цифрах',
    'featured.label': 'Избранные продукты',
    'featured.title': 'Фактура. Свет. Материал.',
    'all.products': 'Все продукты',
    details: 'Подробнее',
    view: 'Смотреть',
    'news.label': 'Новости',
    'news.title': 'Последние новости',
    'news.all': 'Все новости',
    'clients.label': 'Наши клиенты',
    'cta.label': 'Свяжитесь с нами',
    'cta.title': 'Привнесём дух Италии на ваши стены',
    'cta.button': 'Написать нам',
    'footer.text': 'Novacolor родилась в 1982 году в Форли, Италия.',
    'footer.links': 'Полезные ссылки',
    'footer.contact': 'Контакты',
    'footer.rights': 'Все права защищены',
    'footer.top': 'Наверх',
    'products.title': 'Продукты',
    'products.intro': 'Металлики, минеральные штукатурки, окисление, бетон-арт и матовые краски — полная коллекция Novacolor для интерьеров и фасадов.',
    'products.all': 'Все',
    'products.count': 'продуктов',
    'product.category': 'Категория',
    'product.description': 'Описание',
    'product.gallery': 'Фактуры и интерьеры',
    'product.consult': 'Получить консультацию по продукту',
    'product.next': 'Следующий продукт',
    'product.back': 'Все продукты',
    'docs.label': 'Сертификаты и документы',
    'docs.title': 'Качество в документах',
    'docs.company': 'Сертификаты компании',
    'docs.product': 'Сертификаты продукции',
    'docs.epd': 'Экологические декларации (EPD)',
    'docs.note': 'Документы в оригинале — на английском или итальянском языке.',
    'about.page.label': 'О нас',
    'about.milestone1': 'Основана в Форли, в самом сердце одного из самых продуктивных регионов Италии.',
    'about.milestone2': 'Вошла в венецианскую San Marco Group и стала ведущим брендом группы в сфере декоративной отделки.',
    'about.values.label': 'Наши принципы',
    'about.value1': 'Интуиция',
    'about.value2': 'Креативность',
    'about.value3': 'Качественное сырьё',
    'news.page.title': 'Новости',
    'news.page.intro': 'Новые фактуры и продукты коллекции Novacolor.',
    'news.read': 'Смотреть продукт',
    'contact.label': 'Свяжитесь с нами',
    'contact.title': 'Напишите нам сообщение',
    'contact.name': 'Имя',
    'contact.phone': 'Телефон',
    'contact.message': 'Сообщение',
    'contact.send': 'Отправить',
    'contact.sending': 'Отправка…',
    'contact.sent': 'Спасибо! Сообщение отправлено. Мы скоро свяжемся с вами.',
    'contact.copied': 'Сообщение скопировано. Telegram открыт — отправьте его в @novacolor_uz.',
    'contact.error': 'Не удалось отправить. Пожалуйста, позвоните нам.',
    'contact.address': 'Адрес',
    'contact.email': 'Email',
    'contact.socials': 'Соцсети',
    'contact.product': 'Продукт',
    'notfound.title': 'Страница не найдена',
    'notfound.back': 'Вернуться на главную',
    'month.12': 'декабря',
  },
} satisfies Record<Lang, Record<string, string>>

export type Key = keyof (typeof dict)['uz']

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: Key) => string
  l: (v: Localized) => string
}

const LangContext = createContext<Ctx | null>(null)

const initial = (): Lang => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('nc-lang') : null
  return saved === 'ru' ? 'ru' : 'uz'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)
  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('nc-lang', l)
    document.documentElement.lang = l
    setLangState(l)
  }, [])
  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t: (k) => dict[lang][k], l: (v) => v[lang] }),
    [lang, setLang],
  )
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang outside LangProvider')
  return ctx
}

export function formatDate(iso: string, lang: Lang) {
  const [y, m, d] = iso.split('-')
  const month = m === '12' ? dict[lang]['month.12'] : m
  return `${Number(d)} ${month} ${y}`
}
