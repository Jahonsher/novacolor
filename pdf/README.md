# PDF fayllar

Saytda ishlatiladigan PDF fayllar (kataloglar, prays-listlar, sertifikatlar) shu papkaga yuklanadi.

**GitHub'dan yuklash:** shu papkada turib **Add file → Upload files** → PDF faylni tanlang → **Commit changes**.

Fayl nomida bo'sh joy va maxsus belgilar ishlatmang — masalan: `novacolor-katalog-2026.pdf`.

Sayt joylangandan keyin fayl shu manzilda ochiladi:
`https://jahonsher.github.io/novacolor/pdf/FAYL-NOMI.pdf`

**Saytda ko'rinishi uchun:** yangi PDF'ni `src/data/content.json` faylidagi `documents` ro'yxatiga qo'shish kerak
(`file`, `group`: company / product / epd, `title` uz/ru, `products` — mahsulot slug'lari, `size` KB).
Shunda u "Biz haqimizda" sahifasidagi sertifikatlar bo'limida va tegishli mahsulot sahifalarida chiqadi.
