<div align="center">
  <h1>Paranoid Guard - Discord Vanity URL Koruma Sistemi</h1>
  <p>Hedef Discord sunucunuzun özel bağlantısını (Vanity URL) koruyan, URL çalınmaya veya değiştirilmeye çalışıldığında milisaniyeler içinde geri alan ve eylemi gerçekleştiren kullanıcıyı sunucudan uzaklaştıran gelişmiş bir güvenlik aracıdır.</p>
</div>

<br>

## ⚙️ Projenin Amacı ve Yapısı
<hr>

* 📍 **Focus:** Hedef sunucunun Vanity URL'sini (Örn: discord.gg/paranoid) 7/24 izlemek ve herhangi bir yetkili tarafından yanlışlıkla veya kötü niyetle değiştirilmesi durumunda anında eski haline getirmek.
* 📍 **Milisaniyelik Tepki:** Sistem HTTP/2 ve TLS soket havuzlarını (Pre-warmed) hazırda bekleterek, URL değişikliği tespit edildiğinde aynı anda birden fazla kanaldan (HTTP/2, TLS, Axios) PATCH istekleri atıp URL'yi anında geri alır.
* 📍 **Otomatik Cezalandırma:** URL'yi başarıyla geri aldıktan sonra Discord'un Audit Log (Denetim Kaydı) API'sine bağlanarak URL'yi değiştiren suçluyu tespit eder ve sunucudan kalıcı olarak yasaklar.

<br>

## 💻 Kullanılan Teknolojiler ve Eklentiler
<hr>

Bu proje **Node.js (JavaScript - ES Modules)** kullanılarak geliştirilmiştir ve maksimum hız, düşük gecikme oranları için tasarlanmıştır.

**Kullanılan Temel Paketler (Bağımlılıklar):**
* `discord.js-selfbot-v13`: Discord API'si ile etkileşim kurmak ve bildirim kanallarına mesaj göndermek için.
* `axios`: Yedek (fallback) PATCH istekleri ve genel HTTP yönetimi için.
* `ws` (WebSocket): Discord Gateway'den olay (GUILD_UPDATE) dinlemek ve URL değişimlerini milisaniye bazında yakalamak için.
* `chalk`: Konsol loglarını renklendirmek ve okunabilirliği artırmak için.
* `extract-json-from-string`: Gelen ham soket yanıtlarındaki (TLS socket) JSON verilerini güvenli bir şekilde ayrıştırmak için.

**Dahili Node.js Modülleri (Performans Optimizasyonları İçin):**
* `http2`: Çoklu paralel istekler ve düşük gecikme sağlayan kalıcı (keep-alive) oturumlar için.
* `tls`: Doğrudan güvenli soket bağlantısı kurarak en düşük seviyeden raw HTTP istekleri yollamak için.

<br>

## 🛠️ Detaylı Özellikler ve Çalışma Mantığı
<hr>

Eklentinin öne çıkan mimari özellikleri şunlardır:

* **MFA (Multi-Factor Authentication) Yönetimi:** Kod, bot hesabı için gerekli olan MFA işlemlerini ve bilet yenilemelerini otomatik olarak arka planda yapar, yetkilendirme kopmalarını önler.
* **Bağlantı Havuzu (Connection Pooling):** İstek atılacağı an bağlantı kurmak vakit kaybettireceğinden, TLS ve HTTP/2 bağlantıları sistem başladığında oluşturulur ve `connectionRefreshLoop` ile sürekli sıcak tutulur.
* **Gateway İzleme:** Sadece hedef sunucuyu (Hedef Guild ID) dinler, gereksiz yükten kaçınır. API'den bilgi çekmek yerine doğrudan WebSocket (Gateway) `GUILD_UPDATE` eventini bekler.
* **Selfbot Bildirimleri:** Sistemin aktif olması, URL'nin başarıyla geri alınması veya log kayıtları gibi tüm önemli gelişmeleri belirttiğiniz bir Discord kanalına `Selfbot` altyapısı ile anlık olarak iletir.

> [!WARNING]
> Bu araç, API sınırlarını ve hız (Rate Limit) kısıtlamalarını aşmamaya özen göstermekle birlikte, çok agresif istekler attığı durumlarda geçici olarak Discord API engeli (429 Rate Limit) ile karşılaşabilir. İstek sayısı havuzlar üzerinden (HTTP/2, TLS) özenle optimize edilmiştir.

