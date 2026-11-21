// Pedidos HomePoint — app de escritorio para Windows.
//
// Es una ventana (motor WebView2, el mismo de Edge que ya trae Windows) que
// abre pedidosv2.html directo desde el hosting. Cada cambio que se sube al
// sitio aparece acá sin reinstalar. Al arrancar se borra la caché de archivos
// para que siempre lleguen los recién publicados; el login y los datos que
// guarda la web no se tocan.
//
// El .exe también se actualiza solo desde el hosting: lee
// /pedidosv2/escritorio/version.txt y, si hay uno más nuevo, baja
// PedidosHomePoint.exe, verifica su huella (sha256) y lo deja en lugar del
// actual. Se aplica al volver a abrir (o al tocar "Reiniciar ahora").
//
// Un solo archivo: la primera vez que se abre desde Descargas se instala solo
// en %LOCALAPPDATA%\Programs\PedidosHomePoint, crea los accesos directos y se
// registra en "Agregar o quitar programas".
//
// Escrito en C# 5 para compilar con el csc.exe que viene con Windows
// (ver compilar.ps1): no hace falta instalar Visual Studio ni nada.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Pedidos HomePoint")]
[assembly: AssemblyProduct("Pedidos HomePoint")]
[assembly: AssemblyCompany("Homepoint")]
[assembly: AssemblyDescription("Pedidos HomePoint para Windows")]
[assembly: AssemblyVersion(VersionApp.Numero)]
[assembly: AssemblyFileVersion(VersionApp.Numero)]

namespace PedidosHomePoint
{
    static class Config
    {
        public const string Sitio = "https://home-point-admin.dev.ar";
        public const string RutaApp = "/pedidosv2/pedidosv2.html";
        public const string RutaActualizaciones = "/pedidosv2/escritorio/";
        public const string Nombre = "Pedidos HomePoint";
        public const string NombreExe = "PedidosHomePoint.exe";
        public const string ClaveDesinstalar = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PedidosHomePoint";
        public const string Mutex = @"Local\PedidosHomePoint";
        public const string EventoMostrar = @"Local\PedidosHomePoint-Mostrar";
        public const string DescargaWebView2 = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        // Para probar contra un servidor local: set PEDIDOS_URL=http://localhost:5500/pedidosv2/pedidosv2.html
        public static string UrlApp
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("PEDIDOS_URL");
                return string.IsNullOrEmpty(env) ? Sitio + RutaApp : env;
            }
        }

        // Para probar actualizaciones contra un servidor local: set PEDIDOS_ACTUALIZACIONES=http://localhost:8080/
        public static string UrlActualizaciones
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("PEDIDOS_ACTUALIZACIONES");
                return string.IsNullOrEmpty(env) ? Sitio + RutaActualizaciones : env;
            }
        }

        public static string CarpetaInstalacion
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "PedidosHomePoint");
            }
        }

        public static string CarpetaDatos
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "PedidosHomePoint");
            }
        }

        public static string ExeInstalado
        {
            get { return Path.Combine(CarpetaInstalacion, NombreExe); }
        }
    }

    static class Programa
    {
        [STAThread]
        static void Main(string[] args)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            List<string> a = new List<string>(args);

            if (a.Contains("--desinstalar")) { Instalador.Desinstalar(); return; }

            string carpetaExe = Path.GetDirectoryName(Application.ExecutablePath);
            if (!a.Contains("--portable") && !MismaCarpeta(carpetaExe, Config.CarpetaInstalacion))
            {
                Instalador.Instalar();
                return;
            }

            // Una sola ventana: si ya está abierta, se trae al frente.
            bool propio;
            Mutex mutex = new Mutex(true, Config.Mutex, out propio);
            if (!propio && a.Contains("--reinicio"))
            {
                try { propio = mutex.WaitOne(20000); }
                catch (AbandonedMutexException) { propio = true; }
            }
            if (!propio)
            {
                try { EventWaitHandle.OpenExisting(Config.EventoMostrar).Set(); } catch { }
                return;
            }

            Actualizador.LimpiarRestos();
            Recursos.Extraer(carpetaExe);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Arrancar();
            GC.KeepAlive(mutex);
        }

        // Separado para que las DLL de WebView2 se carguen recién acá, después
        // de extraerlas al lado del .exe.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Arrancar()
        {
            Application.Run(new Ventana());
        }

        public static bool MismaCarpeta(string x, string y)
        {
            try
            {
                return string.Equals(Path.GetFullPath(x).TrimEnd('\\'), Path.GetFullPath(y).TrimEnd('\\'),
                    StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }
    }

    // Las DLL de WebView2 viajan adentro del .exe y se extraen al lado.
    static class Recursos
    {
        static readonly string[] Dlls = {
            "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll",
            "WebView2Loader.dll"
        };

        public static void Extraer(string carpeta)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string nombre in Dlls)
            {
                byte[] datos;
                using (Stream s = asm.GetManifestResourceStream(nombre))
                {
                    if (s == null) continue;
                    datos = new byte[s.Length];
                    int leidos = 0;
                    while (leidos < datos.Length) leidos += s.Read(datos, leidos, datos.Length - leidos);
                }
                string destino = Path.Combine(carpeta, nombre);
                try
                {
                    if (File.Exists(destino) && Iguales(File.ReadAllBytes(destino), datos)) continue;
                    File.WriteAllBytes(destino, datos);
                }
                catch { /* en uso: queda la que estaba */ }
            }
        }

        static bool Iguales(byte[] x, byte[] y)
        {
            if (x.Length != y.Length) return false;
            for (int i = 0; i < x.Length; i++) if (x[i] != y[i]) return false;
            return true;
        }
    }

    static class Instalador
    {
        public static void Instalar()
        {
            string origen = Application.ExecutablePath;
            string destino = Config.ExeInstalado;
            try
            {
                Directory.CreateDirectory(Config.CarpetaInstalacion);
                CopiarExe(origen, destino);
                Recursos.Extraer(Config.CarpetaInstalacion);
                CrearAcceso(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Config.Nombre + ".lnk"), destino);
                CrearAcceso(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    Config.Nombre + ".lnk"), destino);
                Registrar(destino);
            }
            catch (Exception ex)
            {
                MessageBox.Show("No se pudo instalar Pedidos HomePoint.\n\n" + ex.Message, Config.Nombre,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Process.Start(destino);
        }

        // Si la app está abierta el .exe está en uso: se renombra (Windows lo
        // permite) y se pone el nuevo en su lugar.
        static void CopiarExe(string origen, string destino)
        {
            try { File.Copy(origen, destino, true); return; }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            string viejo = destino + ".old";
            try { File.Delete(viejo); } catch { }
            File.Move(destino, viejo);
            File.Copy(origen, destino, true);
        }

        static void CrearAcceso(string ruta, string destino)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { ruta });
            Type lt = lnk.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { destino });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { Path.GetDirectoryName(destino) });
            lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { destino + ",0" });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { Config.Nombre });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
        }

        public static void Registrar(string exe)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(Config.ClaveDesinstalar))
            {
                k.SetValue("DisplayName", Config.Nombre);
                k.SetValue("DisplayVersion", VersionApp.Numero);
                k.SetValue("Publisher", "Homepoint");
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", Config.CarpetaInstalacion);
                k.SetValue("UninstallString", "\"" + exe + "\" --desinstalar");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", 1500, RegistryValueKind.DWord);
            }
        }

        public static void Desinstalar()
        {
            bool propio;
            using (Mutex m = new Mutex(true, Config.Mutex, out propio))
            {
                if (!propio)
                {
                    MessageBox.Show("Cerrá Pedidos HomePoint antes de desinstalarlo.", Config.Nombre,
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                if (MessageBox.Show("¿Desinstalar Pedidos HomePoint de esta PC?", Config.Nombre,
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;

                try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Config.Nombre + ".lnk")); } catch { }
                try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Config.Nombre + ".lnk")); } catch { }
                try { Registry.CurrentUser.DeleteSubKeyTree(Config.ClaveDesinstalar, false); } catch { }

                // El .exe no se puede borrar a sí mismo: lo hace un cmd oculto
                // unos segundos después de que esto termine.
                string cmd = "/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"" + Config.CarpetaInstalacion +
                             "\" & rmdir /s /q \"" + Config.CarpetaDatos + "\"";
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd);
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
                m.ReleaseMutex();
            }
        }
    }

    static class Actualizador
    {
        public static void LimpiarRestos()
        {
            try { File.Delete(Application.ExecutablePath + ".old"); } catch { }
            try { File.Delete(Application.ExecutablePath + ".new"); } catch { }
        }

        // Devuelve la versión nueva ya instalada en disco, o null si no hay.
        public static async Task<string> BuscarEInstalar()
        {
            string baseUrl = Config.UrlActualizaciones;
            using (WebClient wc = new WebClient())
            {
                wc.Headers[HttpRequestHeader.CacheControl] = "no-cache";
                string txt = await wc.DownloadStringTaskAsync(baseUrl + "version.txt?t=" + DateTime.UtcNow.Ticks);

                Dictionary<string, string> datos = new Dictionary<string, string>();
                foreach (string linea in txt.Split('\n'))
                {
                    int i = linea.IndexOf('=');
                    if (i > 0) datos[linea.Substring(0, i).Trim().ToLowerInvariant()] = linea.Substring(i + 1).Trim();
                }
                string version, sha;
                if (!datos.TryGetValue("version", out version) || !datos.TryGetValue("sha256", out sha)) return null;
                if (Comparar(version, VersionApp.Numero) <= 0) return null;

                wc.Headers[HttpRequestHeader.CacheControl] = "no-cache";
                byte[] exe = await wc.DownloadDataTaskAsync(baseUrl + Config.NombreExe + "?v=" + Uri.EscapeDataString(version));
                if (!string.Equals(Sha256(exe), sha, StringComparison.OrdinalIgnoreCase)) return null;

                string actual = Application.ExecutablePath;
                string nuevo = actual + ".new";
                string viejo = actual + ".old";
                File.WriteAllBytes(nuevo, exe);
                try { File.Delete(viejo); } catch { }
                File.Move(actual, viejo);
                try { File.Move(nuevo, actual); }
                catch { File.Move(viejo, actual); throw; }

                try
                {
                    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Config.ClaveDesinstalar, true))
                        if (k != null) k.SetValue("DisplayVersion", version);
                }
                catch { }
                return version;
            }
        }

        static string Sha256(byte[] datos)
        {
            using (SHA256 h = SHA256.Create())
            {
                StringBuilder sb = new StringBuilder();
                foreach (byte b in h.ComputeHash(datos)) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        static int Comparar(string x, string y)
        {
            string[] a = x.Split('.'), b = y.Split('.');
            for (int i = 0; i < Math.Max(a.Length, b.Length); i++)
            {
                int na = 0, nb = 0;
                if (i < a.Length) int.TryParse(a[i], out na);
                if (i < b.Length) int.TryParse(b[i], out nb);
                if (na != nb) return na.CompareTo(nb);
            }
            return 0;
        }
    }

    class Ventana : Form
    {
        const int ReintentoMs = 10000;
        const int PrimerChequeoMs = 20000;
        const int EntreChequeosMs = 4 * 60 * 60 * 1000;

        readonly WebView2 web;
        readonly System.Windows.Forms.Timer reintento = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer chequeo = new System.Windows.Forms.Timer();
        readonly Uri origen = new Uri(Config.UrlApp);
        bool avisoMostrado;
        bool pantallaCompleta;
        FormWindowState estadoPrevio;

        public Ventana()
        {
            Text = Config.Nombre;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            BackColor = Color.FromArgb(0xee, 0xf2, 0xf7);
            MinimumSize = new Size(800, 560);
            Size = new Size(1400, 900);
            StartPosition = FormStartPosition.CenterScreen;
            WindowState = FormWindowState.Maximized;

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BackColor;
            web.KeyDown += Teclas;
            Controls.Add(web);

            reintento.Interval = ReintentoMs;
            reintento.Tick += delegate { reintento.Stop(); Abrir(); };

            chequeo.Interval = PrimerChequeoMs;
            chequeo.Tick += delegate { chequeo.Interval = EntreChequeosMs; BuscarActualizacion(); };

            Load += delegate { Iniciar(); };
            EscucharSegundaInstancia();
        }

        async void Iniciar()
        {
            try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (WebView2RuntimeNotFoundException)
            {
                if (MessageBox.Show("Falta un componente de Windows (WebView2 Runtime) para abrir la app.\n\n" +
                        "¿Abrir la página de descarga de Microsoft? Instalalo y volvé a abrir Pedidos HomePoint.",
                        Config.Nombre, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    AbrirAfuera(Config.DescargaWebView2);
                Close();
                return;
            }

            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null,
                    Path.Combine(Config.CarpetaDatos, "Datos"), null);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show("No se pudo iniciar la ventana.\n\n" + ex.Message, Config.Nombre,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            CoreWebView2 cw = web.CoreWebView2;

            // Archivos siempre frescos del host: se borra solo la caché HTTP.
            // El login de Firebase y los datos guardados de la web quedan.
            try { await cw.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache); } catch { }

            cw.Settings.IsStatusBarEnabled = false;
            cw.Settings.IsPasswordAutosaveEnabled = true;
            cw.Settings.IsGeneralAutofillEnabled = true;

            cw.DocumentTitleChanged += delegate
            {
                string t = cw.DocumentTitle;
                Text = string.IsNullOrEmpty(t) || t.StartsWith("data:") || t == "about:blank" ? Config.Nombre : t;
            };
            cw.NavigationStarting += AlNavegar;
            cw.NewWindowRequested += AlPedirVentana;
            cw.PermissionRequested += AlPedirPermiso;
            cw.NavigationCompleted += AlTerminarNavegacion;
            cw.ContainsFullScreenElementChanged += delegate { PonerPantallaCompleta(cw.ContainsFullScreenElement); };

            Abrir();
            chequeo.Start();
        }

        void Abrir()
        {
            reintento.Stop();
            if (web.CoreWebView2 != null) web.CoreWebView2.Navigate(Config.UrlApp);
        }

        bool EsDelSitio(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
            return u.Scheme == origen.Scheme && string.Equals(u.Host, origen.Host, StringComparison.OrdinalIgnoreCase) && u.Port == origen.Port;
        }

        static bool EsWeb(string url)
        {
            return url.StartsWith("http:", StringComparison.OrdinalIgnoreCase) ||
                   url.StartsWith("https:", StringComparison.OrdinalIgnoreCase);
        }

        static bool EsExterna(string url)
        {
            string[] esquemas = { "mailto:", "tel:", "whatsapp:", "sms:" };
            foreach (string e in esquemas) if (url.StartsWith(e, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        // Dentro de la app solo se navega por el sitio propio. WhatsApp y
        // cualquier otro sitio se abren en el navegador / app de Windows.
        void AlNavegar(object s, CoreWebView2NavigationStartingEventArgs e)
        {
            string url = e.Uri ?? "";
            if ((EsWeb(url) && !EsDelSitio(url)) || EsExterna(url))
            {
                e.Cancel = true;
                AbrirAfuera(url);
            }
        }

        void AlPedirVentana(object s, CoreWebView2NewWindowRequestedEventArgs e)
        {
            string url = e.Uri ?? "";
            // window.open('', '_blank') de "Artículos necesarios" escribe ahí
            // la hoja a imprimir: se deja abrir como ventana propia.
            if (url == "" || url == "about:blank" || EsDelSitio(url)) return;
            e.Handled = true;
            AbrirAfuera(url);
        }

        // Cámara (escaneo de QR), portapapeles (copiar cotización) y avisos:
        // solo para el sitio propio.
        void AlPedirPermiso(object s, CoreWebView2PermissionRequestedEventArgs e)
        {
            if (!EsDelSitio(e.Uri)) return;
            switch (e.PermissionKind)
            {
                case CoreWebView2PermissionKind.Camera:
                case CoreWebView2PermissionKind.Microphone:
                case CoreWebView2PermissionKind.ClipboardRead:
                case CoreWebView2PermissionKind.Notifications:
                case CoreWebView2PermissionKind.MultipleAutomaticDownloads:
                    e.State = CoreWebView2PermissionState.Allow;
                    break;
            }
        }

        // Sin internet: pantalla propia y reintento automático.
        void AlTerminarNavegacion(object s, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess) return;
            switch (e.WebErrorStatus)
            {
                case CoreWebView2WebErrorStatus.Disconnected:
                case CoreWebView2WebErrorStatus.ConnectionAborted:
                case CoreWebView2WebErrorStatus.ConnectionReset:
                case CoreWebView2WebErrorStatus.CannotConnect:
                case CoreWebView2WebErrorStatus.HostNameNotResolved:
                case CoreWebView2WebErrorStatus.Timeout:
                case CoreWebView2WebErrorStatus.ServerUnreachable:
                    web.CoreWebView2.NavigateToString(PaginaSinConexion());
                    reintento.Start();
                    break;
            }
        }

        string PaginaSinConexion()
        {
            string url = Config.UrlApp.Replace("\\", "\\\\").Replace("'", "\\'");
            return "<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'><title>Pedidos HomePoint</title><style>" +
                "html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;" +
                "background:#eef2f7;color:#1e3a5f;font-family:'Segoe UI',system-ui,sans-serif}" +
                ".c{text-align:center;max-width:420px;padding:32px}h1{font-size:22px;margin:0 0 10px}" +
                "p{margin:0 0 22px;color:#4a5d75;line-height:1.5}" +
                ".s{width:34px;height:34px;margin:0 auto 22px;border:4px solid #c9d5e3;border-top-color:#1e3a5f;" +
                "border-radius:50%;animation:g 1s linear infinite}@keyframes g{to{transform:rotate(360deg)}}" +
                "button{background:#1e3a5f;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:15px;cursor:pointer}" +
                "button:hover{background:#2b4f7d}</style></head><body><div class='c'><div class='s'></div>" +
                "<h1>No hay conexión con el sitio</h1>" +
                "<p>Revisá que la PC tenga internet. La app vuelve a intentar sola cada 10 segundos.</p>" +
                "<button onclick=\"location.href='" + url + "'\">Reintentar ahora</button></div></body></html>";
        }

        void Teclas(object s, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.F11)
            {
                e.Handled = true;
                PonerPantallaCompleta(!pantallaCompleta);
            }
            else if (e.KeyCode == Keys.R && e.Control && e.Shift)
            {
                // Ctrl+Shift+R: borrar caché y recargar.
                e.Handled = true;
                RecargarLimpio();
            }
        }

        async void RecargarLimpio()
        {
            try { await web.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache); } catch { }
            web.CoreWebView2.Reload();
        }

        void PonerPantallaCompleta(bool si)
        {
            if (si == pantallaCompleta) return;
            pantallaCompleta = si;
            if (si)
            {
                estadoPrevio = WindowState;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                WindowState = FormWindowState.Maximized;
            }
            else
            {
                FormBorderStyle = FormBorderStyle.Sizable;
                WindowState = estadoPrevio;
            }
        }

        static void AbrirAfuera(string url)
        {
            try { Process.Start(url); } catch { }
        }

        async void BuscarActualizacion()
        {
            if (avisoMostrado) return;
            string version;
            try { version = await Actualizador.BuscarEInstalar(); }
            catch { return; }
            if (version == null || avisoMostrado) return;
            avisoMostrado = true;
            chequeo.Stop();
            if (MessageBox.Show(this,
                    "Hay una versión nueva de Pedidos HomePoint (" + version + ").\n\n" +
                    "Se aplica la próxima vez que abras la app. ¿Reiniciar ahora?\n" +
                    "(Guardá antes lo que estés editando.)",
                    Config.Nombre, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
            {
                try { Process.Start(Application.ExecutablePath, "--reinicio"); } catch { return; }
                Close();
            }
        }

        // Si se abre la app otra vez (acceso directo), esa segunda copia avisa
        // por este evento y se cierra; acá se trae la ventana al frente.
        void EscucharSegundaInstancia()
        {
            EventWaitHandle ev = new EventWaitHandle(false, EventResetMode.AutoReset, Config.EventoMostrar);
            Thread t = new Thread(delegate ()
            {
                while (true)
                {
                    ev.WaitOne();
                    try { BeginInvoke(new MethodInvoker(TraerAlFrente)); } catch { }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        void TraerAlFrente()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Maximized;
            Show();
            Activate();
            TopMost = true;
            TopMost = false;
        }
    }
}
