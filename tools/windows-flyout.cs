#if !INSTALLER
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed class FlyoutPalette
{
    public Color Ground, Surface, SurfaceAlt, Hover, Border, Rule, Text, Muted;
    public Color Accent, Ok, Warn, Danger, Track;

    public static readonly FlyoutPalette Dark = new FlyoutPalette
    {
        Ground = Color.FromArgb(12, 14, 18),
        Surface = Color.FromArgb(19, 22, 30),
        SurfaceAlt = Color.FromArgb(25, 29, 39),
        Hover = Color.FromArgb(34, 40, 54),
        Border = Color.FromArgb(35, 40, 54),
        Rule = Color.FromArgb(28, 32, 44),
        Text = Color.FromArgb(241, 244, 249),
        Muted = Color.FromArgb(141, 149, 167),
        Accent = Color.FromArgb(79, 148, 232),
        Ok = Color.FromArgb(52, 199, 133),
        Warn = Color.FromArgb(226, 169, 59),
        Danger = Color.FromArgb(234, 88, 111),
        Track = Color.FromArgb(34, 39, 52)
    };

    public static readonly FlyoutPalette Light = new FlyoutPalette
    {
        Ground = Color.FromArgb(238, 241, 246),
        Surface = Color.FromArgb(255, 255, 255),
        SurfaceAlt = Color.FromArgb(245, 247, 251),
        Hover = Color.FromArgb(232, 237, 245),
        Border = Color.FromArgb(212, 219, 231),
        Rule = Color.FromArgb(228, 233, 242),
        Text = Color.FromArgb(17, 22, 34),
        Muted = Color.FromArgb(81, 91, 112),
        Accent = Color.FromArgb(20, 92, 208),
        Ok = Color.FromArgb(17, 120, 70),
        Warn = Color.FromArgb(163, 96, 0),
        Danger = Color.FromArgb(196, 37, 55),
        Track = Color.FromArgb(224, 230, 240)
    };
}

internal sealed class FlyoutQuotaBucket
{
    public string Window;
    public double? Percent;
    public string ResetsAt;
}

internal sealed class FlyoutQuotaGroup
{
    public string Id;
    public string Label;
    public bool Active;
    public FlyoutQuotaBucket FiveHour;
    public FlyoutQuotaBucket Weekly;
}

internal sealed class FlyoutModel
{
    public string Status = "connecting";
    public string Title = "Connecting to Antigravity...";
    public string ModelName = "";
    public string Workspace = "";
    public string AccountEmail = null;
    public string MaskedEmail = null;
    public bool MaskDefault = true;
    public double? Percent = null;
    public long? Used = null;
    public long? Capacity = null;
    public long? Remaining = null;
    public int WarningThreshold = 80;
    public string Source = "";
    public string MeasuredTime = "";
    public long Input = 0, CacheRead = 0, CacheCreate = 0, Output = 0;
    public long TotalInput = 0, TotalCacheRead = 0, TotalCacheCreate = 0, TotalOutput = 0, TotalCalls = 0;
    public double? TokPerSec = null;
    public long TodayTokens = 0, MonthTokens = 0;
    public string CheckedTime = "";
    public List<FlyoutQuotaGroup> Pools = new List<FlyoutQuotaGroup>();
}

internal sealed class TrayFlyoutForm : Form
{
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWA_BORDER_COLOR = 34;
    private const int DWMWCP_ROUND = 2;
    private const int CS_DROPSHADOW = 0x00020000;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private readonly string _dashboardUrl;
    private readonly Action _onOpenInAntigravity;
    private readonly System.Windows.Forms.Timer _pollTimer;
    private readonly Icon _brandIcon;
    private readonly string _themeFile;

    private FlyoutModel _model = new FlyoutModel();
    private bool _darkTheme;
    private bool? _emailRevealed = null;
    private bool _fetching = false;
    private string _hoveredId = null;

    private Rectangle _rcEmail, _rcTheme, _rcRefresh, _rcClose, _rcOpenAg;

    private readonly Font _fTitle = new Font("Segoe UI Semibold", 10.5f);
    private readonly Font _fSection = new Font("Segoe UI Semibold", 9.0f);
    private readonly Font _fHero = new Font("Segoe UI", 22f, FontStyle.Bold);
    private readonly Font _fMono = new Font("Consolas", 9.0f);
    private readonly Font _fBody = new Font("Segoe UI", 8.75f);
    private readonly Font _fBold = new Font("Segoe UI Semibold", 8.75f);
    private readonly Font _fSmall = new Font("Segoe UI", 8.0f);
    private readonly Font _fKpi = new Font("Segoe UI Semibold", 12.5f);

    public TrayFlyoutForm(string dashboardUrl, Action onOpenInAntigravity)
    {
        _dashboardUrl = dashboardUrl;
        _onOpenInAntigravity = onOpenInAntigravity;
        _themeFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Antigravity Monitor",
            "flyout-theme.txt"
        );
        _darkTheme = LoadInitialDarkTheme();
        try { _brandIcon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        StartPosition = FormStartPosition.Manual;
        KeyPreview = true;
        Text = "Antigravity Monitor";
        ClientSize = new Size(388, 520);

        _pollTimer = new System.Windows.Forms.Timer { Interval = 1500 };
        _pollTimer.Tick += (s, e) => FetchSnapshotAsync();

        KeyDown += (s, e) =>
        {
            if (e.KeyCode == Keys.Escape) { HideFlyout(); e.Handled = true; }
            else if (e.KeyCode == Keys.T) { ToggleTheme(); e.Handled = true; }
            else if (e.KeyCode == Keys.R) { TriggerRefresh(); e.Handled = true; }
        };
        MouseMove += OnMouseMoveHit;
        MouseLeave += (s, e) => { if (_hoveredId != null) { _hoveredId = null; Cursor = Cursors.Default; Invalidate(); } };
        MouseClick += OnMouseClickHit;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ClassStyle |= CS_DROPSHADOW;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyDwmChrome();
    }

    private void ApplyDwmChrome()
    {
        try
        {
            int corner = DWMWCP_ROUND;
            DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
            Color border = Palette.Border;
            int colorRef = border.R | (border.G << 8) | (border.B << 16);
            DwmSetWindowAttribute(Handle, DWMWA_BORDER_COLOR, ref colorRef, sizeof(int));
        }
        catch { }
    }

    private FlyoutPalette Palette { get { return _darkTheme ? FlyoutPalette.Dark : FlyoutPalette.Light; } }

    public void ToggleFlyout()
    {
        if (Visible) { HideFlyout(); return; }
        ShowFlyout();
    }

    public void ShowFlyout()
    {
        PositionBottomRight();
        Show();
        Activate();
        BringToFront();
        _pollTimer.Start();
        FetchSnapshotAsync();
    }

    public void HideFlyout()
    {
        _pollTimer.Stop();
        Hide();
    }

    private void PositionBottomRight()
    {
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        int w = 388;
        int h = Math.Min(524, Math.Max(420, area.Height - 24));
        ClientSize = new Size(w, h);
        Location = new Point(area.Right - w - 12, area.Bottom - h - 12);
    }

    private bool LoadInitialDarkTheme()
    {
        try
        {
            if (File.Exists(_themeFile))
            {
                string saved = File.ReadAllText(_themeFile).Trim().ToLowerInvariant();
                if (saved == "light") return false;
                if (saved == "dark") return true;
            }
        }
        catch { }
        try
        {
            object val = Registry.GetValue(
                @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "AppsUseLightTheme",
                0
            );
            if (val is int && (int)val == 1) return false;
        }
        catch { }
        return true;
    }

    private void ToggleTheme()
    {
        _darkTheme = !_darkTheme;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_themeFile));
            File.WriteAllText(_themeFile, _darkTheme ? "dark" : "light");
        }
        catch { }
        ApplyDwmChrome();
        Invalidate();
    }

    private void TriggerRefresh()
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(_dashboardUrl + "/api/command");
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 1500;
                req.ReadWriteTimeout = 1500;
                byte[] body = System.Text.Encoding.UTF8.GetBytes("{\"type\":\"refresh\"}");
                req.ContentLength = body.Length;
                using (var stream = req.GetRequestStream())
                {
                    stream.Write(body, 0, body.Length);
                }
                using (req.GetResponse()) { }
            }
            catch { }
            FetchSnapshotAsync();
        });
    }

    private void FetchSnapshotAsync()
    {
        if (_fetching || IsDisposed) return;
        _fetching = true;
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(_dashboardUrl + "/api/snapshot");
                req.Timeout = 1500;
                req.ReadWriteTimeout = 1500;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream()))
                {
                    string json = reader.ReadToEnd();
                    FlyoutModel parsed = ParseSnapshot(json);
                    if (!IsDisposed && IsHandleCreated)
                    {
                        BeginInvoke((Action)(() =>
                        {
                            _model = parsed;
                            Invalidate();
                        }));
                    }
                }
            }
            catch
            {
                if (!IsDisposed && IsHandleCreated)
                {
                    BeginInvoke((Action)(() =>
                    {
                        _model.Status = "disconnected";
                        _model.Title = "Companion offline";
                        Invalidate();
                    }));
                }
            }
            finally { _fetching = false; }
        });
    }

    private string HitTest(Point pt)
    {
        if (_rcClose.Contains(pt)) return "close";
        if (_rcRefresh.Contains(pt)) return "refresh";
        if (_rcTheme.Contains(pt)) return "theme";
        if (!string.IsNullOrEmpty(_model.AccountEmail) && _rcEmail.Contains(pt)) return "email";
        if (_rcOpenAg.Contains(pt)) return "openAg";
        return null;
    }

    private void OnMouseMoveHit(object sender, MouseEventArgs e)
    {
        string hit = HitTest(e.Location);
        if (hit != _hoveredId)
        {
            _hoveredId = hit;
            Cursor = hit != null ? Cursors.Hand : Cursors.Default;
            Invalidate();
        }
    }

    private void OnMouseClickHit(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        string hit = HitTest(e.Location);
        if (hit == "close") HideFlyout();
        else if (hit == "theme") ToggleTheme();
        else if (hit == "refresh") TriggerRefresh();
        else if (hit == "email")
        {
            bool cur = _emailRevealed.HasValue ? _emailRevealed.Value : !_model.MaskDefault;
            _emailRevealed = !cur;
            Invalidate();
        }
        else if (hit == "openAg")
        {
            HideFlyout();
            if (_onOpenInAntigravity != null) _onOpenInAntigravity();
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        FlyoutPalette p = Palette;
        int W = ClientSize.Width;
        int H = ClientSize.Height;

        using (var bg = new SolidBrush(p.Ground)) g.FillRectangle(bg, 0, 0, W, H);

        // 1. Unified Header Bar
        int headerH = 52;
        using (var sb = new SolidBrush(p.Surface)) g.FillRectangle(sb, 0, 0, W, headerH);
        using (var pen = new Pen(p.Border)) g.DrawLine(pen, 0, headerH, W, headerH);

        if (_brandIcon != null)
        {
            try { g.DrawIcon(_brandIcon, new Rectangle(14, 14, 22, 22)); } catch { }
        }
        DrawText(g, "Antigravity Monitor", _fTitle, p.Text, new Rectangle(44, 9, 175, 19), StringAlignment.Near);

        string emailText = !string.IsNullOrEmpty(_model.AccountEmail)
            ? ((_emailRevealed.HasValue ? _emailRevealed.Value : !_model.MaskDefault) ? _model.AccountEmail : _model.MaskedEmail)
            : "Local telemetry";
        _rcEmail = new Rectangle(44, 28, 185, 18);
        Color emailColor = _hoveredId == "email" ? p.Accent : p.Muted;
        DrawText(g, emailText, _fSmall, emailColor, _rcEmail, StringAlignment.Near);

        // Header icon buttons (right-aligned)
        int btnY = 12, btnS = 28;
        _rcClose = new Rectangle(W - 12 - btnS, btnY, btnS, btnS);
        _rcRefresh = new Rectangle(_rcClose.X - 6 - btnS, btnY, btnS, btnS);
        _rcTheme = new Rectangle(_rcRefresh.X - 6 - btnS, btnY, btnS, btnS);
        DrawIconButton(g, _rcTheme, "theme", p);
        DrawIconButton(g, _rcRefresh, "refresh", p);
        DrawIconButton(g, _rcClose, "close", p);

        // Status dot pill left of theme button
        string statusText = _model.Status == "ok" ? "Live"
            : _model.Status == "unauthorized" ? "Auth"
            : _model.Status == "disconnected" ? "Standby" : "Sync";
        Color statusColor = _model.Status == "ok" ? p.Ok
            : _model.Status == "unauthorized" ? p.Danger : p.Muted;
        Rectangle rcStatus = new Rectangle(_rcTheme.X - 52, 16, 46, 20);
        DrawBadge(g, rcStatus, statusText, statusColor, p);

        int y = headerH + 10;
        int pad = 12;
        int cardW = W - pad * 2;

        // 2. Context Window Card
        int ctxH = 148;
        Rectangle rcCtx = new Rectangle(pad, y, cardW, ctxH);
        DrawCard(g, rcCtx, p);
        DrawText(g, "Context window", _fSection, p.Text, new Rectangle(rcCtx.X + 12, rcCtx.Y + 10, 120, 18), StringAlignment.Near);
        DrawText(g, _model.Title, _fSmall, p.Muted, new Rectangle(rcCtx.X + 132, rcCtx.Y + 11, cardW - 144, 16), StringAlignment.Far);

        string pctText = _model.Percent.HasValue ? FormatPercent(_model.Percent.Value) : "—";
        Color bandColor = !_model.Percent.HasValue ? p.Text
            : _model.Percent.Value >= 95 ? p.Danger
            : _model.Percent.Value >= _model.WarningThreshold ? p.Warn : p.Text;
        DrawText(g, pctText, _fHero, bandColor, new Rectangle(rcCtx.X + 10, rcCtx.Y + 32, 125, 36), StringAlignment.Near);

        string volText = _model.Used.HasValue
            ? FormatTokens(_model.Used.Value) + (_model.Capacity.HasValue ? " / " + FormatTokens(_model.Capacity.Value) : " tok")
            : "Waiting for reading";
        DrawText(g, volText, _fMono, p.Muted, new Rectangle(rcCtx.X + 128, rcCtx.Y + 46, 145, 20), StringAlignment.Near);

        if (!string.IsNullOrEmpty(_model.Source))
        {
            Color srcColor = _model.Source == "measured" ? p.Ok : p.Warn;
            DrawBadge(g, new Rectangle(rcCtx.Right - 78, rcCtx.Y + 41, 66, 20),
                _model.Source == "measured" ? "Measured" : "Estimated", srcColor, p);
        }

        // Progress ruler
        Rectangle rcBar = new Rectangle(rcCtx.X + 12, rcCtx.Y + 76, cardW - 24, 7);
        Color fillColor = !_model.Percent.HasValue ? p.Accent
            : _model.Percent.Value >= 95 ? p.Danger
            : _model.Percent.Value >= _model.WarningThreshold ? p.Warn : p.Accent;
        DrawProgressBar(g, rcBar, _model.Percent ?? 0, fillColor, p, _model.WarningThreshold);

        string remText = _model.Remaining.HasValue ? FormatTokens(_model.Remaining.Value) + " remaining" : "Capacity unknown";
        long turnPrompt = _model.Input + _model.CacheRead + _model.CacheCreate;
        string turnCache = turnPrompt > 0 ? "Cache hit " + FormatRatio(_model.CacheRead, turnPrompt) : "";
        DrawText(g, remText, _fSmall, p.Text, new Rectangle(rcCtx.X + 12, rcCtx.Y + 90, 170, 16), StringAlignment.Near);
        DrawText(g, turnCache, _fSmall, p.Muted, new Rectangle(rcCtx.X + 185, rcCtx.Y + 90, cardW - 197, 16), StringAlignment.Far);

        using (var pen = new Pen(p.Rule)) g.DrawLine(pen, rcCtx.X + 12, rcCtx.Y + 114, rcCtx.Right - 12, rcCtx.Y + 114);
        string attrText = (!string.IsNullOrEmpty(_model.ModelName) ? _model.ModelName : "No model") +
            (!string.IsNullOrEmpty(_model.Workspace) ? "  ·  " + _model.Workspace : "");
        DrawText(g, attrText, _fSmall, p.Muted, new Rectangle(rcCtx.X + 12, rcCtx.Y + 121, cardW - 24, 18), StringAlignment.Near);

        y += ctxH + 10;

        // 3. Quota Pools Card
        int poolCount = Math.Min(3, _model.Pools.Count);
        int quotaH = poolCount == 0 ? 70 : 38 + poolCount * 46;
        Rectangle rcQuota = new Rectangle(pad, y, cardW, quotaH);
        DrawCard(g, rcQuota, p);
        DrawText(g, "Quota pools", _fSection, p.Text, new Rectangle(rcQuota.X + 12, rcQuota.Y + 10, 110, 18), StringAlignment.Near);
        DrawText(g, _model.ModelName, _fSmall, p.Muted, new Rectangle(rcQuota.X + 120, rcQuota.Y + 11, cardW - 132, 16), StringAlignment.Far);

        if (poolCount == 0)
        {
            DrawText(g, "Quota buckets appear once a backend connects.", _fSmall, p.Muted, new Rectangle(rcQuota.X + 12, rcQuota.Y + 38, cardW - 24, 18), StringAlignment.Near);
        }
        else
        {
            int py = rcQuota.Y + 34;
            for (int i = 0; i < poolCount; i++)
            {
                FlyoutQuotaGroup grp = _model.Pools[i];
                if (i > 0) using (var pen = new Pen(p.Rule)) g.DrawLine(pen, rcQuota.X + 12, py - 4, rcQuota.Right - 12, py - 4);
                if (grp.Active)
                {
                    using (var ab = new SolidBrush(p.Accent)) g.FillRectangle(ab, rcQuota.X + 1, py + 1, 3, 34);
                }
                DrawText(g, grp.Label, _fBold, p.Text, new Rectangle(rcQuota.X + 12, py, cardW - 80, 16), StringAlignment.Near);
                if (grp.Active) DrawBadge(g, new Rectangle(rcQuota.Right - 58, py - 1, 46, 17), "Active", p.Accent, p);

                int halfW = (cardW - 36) / 2;
                DrawQuotaBucket(g, new Rectangle(rcQuota.X + 12, py + 19, halfW, 20), "5h", grp.FiveHour, p);
                DrawQuotaBucket(g, new Rectangle(rcQuota.X + 24 + halfW, py + 19, halfW, 20), "Week", grp.Weekly, p);
                py += 46;
            }
        }

        y += quotaH + 10;

        // 4. 3-Column KPI Strip
        int kpiH = 66;
        Rectangle rcKpi = new Rectangle(pad, y, cardW, kpiH);
        DrawCard(g, rcKpi, p);
        int colW = cardW / 3;

        string speedVal = _model.TokPerSec.HasValue && _model.TokPerSec.Value > 0
            ? (_model.TokPerSec.Value >= 10 ? Math.Round(_model.TokPerSec.Value).ToString("N0", CultureInfo.InvariantCulture) : _model.TokPerSec.Value.ToString("0.#", CultureInfo.InvariantCulture)) + " tok/s"
            : "—";
        string speedSub = _model.Output > 0 ? FormatTokens(_model.Output) + " out" : "Waiting";

        long sessPrompt = _model.TotalInput + _model.TotalCacheRead + _model.TotalCacheCreate;
        string cacheVal = sessPrompt > 0 ? FormatRatio(_model.TotalCacheRead, sessPrompt)
            : (turnPrompt > 0 ? FormatRatio(_model.CacheRead, turnPrompt) : "—");
        string cacheSub = _model.TotalCalls > 0 ? _model.TotalCalls + " calls" : "Session";

        string todayVal = FormatTokens(_model.TodayTokens);
        string todaySub = FormatTokens(_model.MonthTokens) + " mo";

        DrawKpiCol(g, new Rectangle(rcKpi.X, rcKpi.Y, colW, kpiH), "Output speed", speedVal, speedSub, p);
        using (var pen = new Pen(p.Rule))
        {
            g.DrawLine(pen, rcKpi.X + colW, rcKpi.Y + 10, rcKpi.X + colW, rcKpi.Bottom - 10);
            g.DrawLine(pen, rcKpi.X + colW * 2, rcKpi.Y + 10, rcKpi.X + colW * 2, rcKpi.Bottom - 10);
        }
        DrawKpiCol(g, new Rectangle(rcKpi.X + colW, rcKpi.Y, colW, kpiH), "Cache hit", cacheVal, cacheSub, p);
        DrawKpiCol(g, new Rectangle(rcKpi.X + colW * 2, rcKpi.Y, cardW - colW * 2, kpiH), "Observed today", todayVal, todaySub, p);

        // 5. Footer Strip
        int footY = H - 30;
        _rcOpenAg = new Rectangle(pad, footY - 2, 185, 22);
        DrawText(g, "Open in Antigravity Panel", _fBold, _hoveredId == "openAg" ? p.Text : p.Accent, _rcOpenAg, StringAlignment.Near);
        string checkedLabel = !string.IsNullOrEmpty(_model.CheckedTime) ? "Updated " + _model.CheckedTime : "Local · 127.0.0.1";
        DrawText(g, checkedLabel, _fSmall, p.Muted, new Rectangle(W - pad - 150, footY, 150, 18), StringAlignment.Far);

        // Outer crisp 1px border
        using (var pen = new Pen(p.Border)) g.DrawRectangle(pen, 0, 0, W - 1, H - 1);
    }

    private void DrawCard(Graphics g, Rectangle rect, FlyoutPalette p)
    {
        using (GraphicsPath path = RoundedRect(rect, 8))
        {
            using (var fill = new SolidBrush(p.Surface)) g.FillPath(fill, path);
            using (var pen = new Pen(p.Border)) g.DrawPath(pen, path);
        }
    }

    private void DrawIconButton(Graphics g, Rectangle rect, string id, FlyoutPalette p)
    {
        bool hot = _hoveredId == id;
        using (GraphicsPath path = RoundedRect(rect, 6))
        {
            using (var fill = new SolidBrush(hot ? p.Hover : p.SurfaceAlt)) g.FillPath(fill, path);
            using (var pen = new Pen(p.Border)) g.DrawPath(pen, path);
        }
        using (var pen = new Pen(hot ? p.Text : p.Muted, 1.5f))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            int cx = rect.X + rect.Width / 2;
            int cy = rect.Y + rect.Height / 2;
            if (id == "close")
            {
                g.DrawLine(pen, cx - 4, cy - 4, cx + 4, cy + 4);
                g.DrawLine(pen, cx + 4, cy - 4, cx - 4, cy + 4);
            }
            else if (id == "refresh")
            {
                g.DrawArc(pen, cx - 5, cy - 5, 10, 10, 35, 290);
                g.DrawLine(pen, cx + 3, cy - 5, cx + 5, cy - 2);
                g.DrawLine(pen, cx + 5, cy - 2, cx + 2, cy - 2);
            }
            else if (id == "theme")
            {
                if (_darkTheme)
                {
                    // Sun icon (switch to Light)
                    g.DrawEllipse(pen, cx - 3, cy - 3, 6, 6);
                    g.DrawLine(pen, cx, cy - 6, cx, cy - 5);
                    g.DrawLine(pen, cx, cy + 5, cx, cy + 6);
                    g.DrawLine(pen, cx - 6, cy, cx - 5, cy);
                    g.DrawLine(pen, cx + 5, cy, cx + 6, cy);
                }
                else
                {
                    // Moon icon (switch to Dark)
                    g.DrawArc(pen, cx - 5, cy - 5, 10, 10, 45, 250);
                    g.DrawArc(pen, cx - 2, cy - 5, 8, 8, 95, 160);
                }
            }
        }
    }

    private void DrawBadge(Graphics g, Rectangle rect, string text, Color tone, FlyoutPalette p)
    {
        using (GraphicsPath path = RoundedRect(rect, 4))
        {
            using (var fill = new SolidBrush(Color.FromArgb(_darkTheme ? 34 : 24, tone))) g.FillPath(fill, path);
            using (var pen = new Pen(Color.FromArgb(_darkTheme ? 90 : 75, tone))) g.DrawPath(pen, path);
        }
        DrawText(g, text, _fSmall, tone, rect, StringAlignment.Center);
    }

    private void DrawProgressBar(Graphics g, Rectangle rect, double percent, Color fillColor, FlyoutPalette p, int warnMark)
    {
        double clamped = Math.Max(0, Math.Min(100, percent));
        using (GraphicsPath track = RoundedRect(rect, 3))
        using (var tb = new SolidBrush(p.Track)) g.FillPath(tb, track);

        int fillW = (int)Math.Round(rect.Width * (clamped / 100.0));
        if (fillW > 2)
        {
            Rectangle fillRect = new Rectangle(rect.X, rect.Y, fillW, rect.Height);
            using (GraphicsPath fp = RoundedRect(fillRect, 3))
            using (var fb = new SolidBrush(fillColor)) g.FillPath(fb, fp);
        }
        if (warnMark > 0 && warnMark < 100)
        {
            int wx = rect.X + (int)Math.Round(rect.Width * (warnMark / 100.0));
            using (var wp = new Pen(p.Warn)) g.DrawLine(wp, wx, rect.Y, wx, rect.Bottom);
        }
    }

    private void DrawQuotaBucket(Graphics g, Rectangle rect, string label, FlyoutQuotaBucket bucket, FlyoutPalette p)
    {
        if (bucket == null || !bucket.Percent.HasValue)
        {
            DrawText(g, label + " —", _fSmall, p.Muted, rect, StringAlignment.Near);
            return;
        }
        string reset = FormatCountdown(bucket.ResetsAt);
        string right = (!string.IsNullOrEmpty(reset) ? reset + "  " : "") + FormatPercent(bucket.Percent.Value);
        DrawText(g, label, _fSmall, p.Muted, new Rectangle(rect.X, rect.Y, 40, 13), StringAlignment.Near);
        DrawText(g, right, _fSmall, p.Text, new Rectangle(rect.X + 32, rect.Y, rect.Width - 32, 13), StringAlignment.Far);
        Color barTone = bucket.Percent.Value <= 10 ? p.Danger : bucket.Percent.Value <= 20 ? p.Warn : p.Accent;
        DrawProgressBar(g, new Rectangle(rect.X, rect.Y + 15, rect.Width, 4), bucket.Percent.Value, barTone, p, 0);
    }

    private void DrawKpiCol(Graphics g, Rectangle rect, string label, string value, string sub, FlyoutPalette p)
    {
        DrawText(g, label, _fSmall, p.Muted, new Rectangle(rect.X + 10, rect.Y + 8, rect.Width - 14, 15), StringAlignment.Near);
        DrawText(g, value, _fKpi, p.Text, new Rectangle(rect.X + 10, rect.Y + 23, rect.Width - 14, 22), StringAlignment.Near);
        DrawText(g, sub, _fSmall, p.Muted, new Rectangle(rect.X + 10, rect.Y + 46, rect.Width - 14, 15), StringAlignment.Near);
    }

    private static void DrawText(Graphics g, string text, Font font, Color color, Rectangle rect, StringAlignment align)
    {
        using (var brush = new SolidBrush(color))
        using (var sf = new StringFormat { Alignment = align, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
        {
            g.DrawString(text ?? "", font, brush, rect, sf);
        }
    }

    private static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        int d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static FlyoutModel ParseSnapshot(string json)
    {
        var m = new FlyoutModel();
        var ser = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        var root = ser.DeserializeObject(json) as Dictionary<string, object>;
        var snap = root != null && root.ContainsKey("snapshot") ? root["snapshot"] as Dictionary<string, object> : null;
        if (snap == null) return m;

        m.Status = Str(snap, "status") ?? "connecting";
        var prefs = Dict(snap, "prefs");
        m.WarningThreshold = (int)(Num(prefs, "warningThreshold") ?? 80);
        m.MaskDefault = Bool(prefs, "maskPersonalInfo") ?? true;

        var account = Dict(snap, "account");
        m.AccountEmail = Str(account, "email");
        if (!string.IsNullOrEmpty(m.AccountEmail)) m.MaskedEmail = MaskEmail(m.AccountEmail);

        var conv = Dict(snap, "conversation");
        if (conv != null)
        {
            m.Title = Str(conv, "title") ?? "Active thread";
            m.ModelName = Str(conv, "modelName") ?? Str(snap, "composerModelName") ?? "";
            m.Workspace = Str(conv, "workspace") ?? "";
            var usage = Dict(conv, "usage");
            if (usage != null)
            {
                m.Percent = Num(usage, "percent");
                m.Used = Int64(usage, "used");
                m.Capacity = Int64(usage, "capacity");
                m.Remaining = Int64(usage, "remaining");
                m.Source = Str(usage, "source") ?? "";
                m.Input = Int64(usage, "input") ?? 0;
                m.CacheRead = Int64(usage, "cacheRead") ?? 0;
                m.CacheCreate = Int64(usage, "cacheCreate") ?? 0;
                m.Output = Int64(usage, "output") ?? 0;
                m.TokPerSec = Num(usage, "tokPerSec");
            }
            var totals = Dict(conv, "totals");
            if (totals != null)
            {
                m.TotalInput = Int64(totals, "input") ?? 0;
                m.TotalCacheRead = Int64(totals, "cacheRead") ?? 0;
                m.TotalCacheCreate = Int64(totals, "cacheCreate") ?? 0;
                m.TotalOutput = Int64(totals, "output") ?? 0;
                m.TotalCalls = Int64(totals, "calls") ?? 0;
            }
        }
        else
        {
            m.Title = m.Status == "unauthorized" ? "Authorization needed"
                : m.Status == "disconnected" ? "Waiting for Antigravity" : "No active conversation";
        }

        var uSummary = Dict(snap, "usage");
        if (uSummary != null)
        {
            m.TodayTokens = Int64(uSummary, "todayTokens") ?? 0;
            m.MonthTokens = Int64(uSummary, "monthTokens") ?? 0;
        }

        string activeGroupId = Str(snap, "activeQuotaGroupId");
        var quota = Dict(snap, "quota");
        if (quota != null)
        {
            long? obs = Int64(quota, "observedAt");
            if (obs.HasValue && obs.Value > 0)
            {
                DateTime dt = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(obs.Value).ToLocalTime();
                m.CheckedTime = dt.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
            }
            var groups = quota.ContainsKey("groups") ? quota["groups"] as object[] : null;
            if (groups != null)
            {
                foreach (object gObj in groups)
                {
                    var gd = gObj as Dictionary<string, object>;
                    if (gd == null) continue;
                    var fg = new FlyoutQuotaGroup
                    {
                        Id = Str(gd, "id") ?? "",
                        Label = Str(gd, "label") ?? "Quota pool",
                        Active = !string.IsNullOrEmpty(activeGroupId) && activeGroupId == Str(gd, "id")
                    };
                    var buckets = gd.ContainsKey("buckets") ? gd["buckets"] as object[] : null;
                    if (buckets != null)
                    {
                        foreach (object bObj in buckets)
                        {
                            var bd = bObj as Dictionary<string, object>;
                            if (bd == null || Bool(bd, "enabled") == false) continue;
                            string win = Str(bd, "window");
                            var fb = new FlyoutQuotaBucket { Window = win, Percent = Num(bd, "percent"), ResetsAt = Str(bd, "resetsAt") };
                            if (win == "5h") fg.FiveHour = fb;
                            else if (win == "weekly") fg.Weekly = fb;
                        }
                    }
                    m.Pools.Add(fg);
                }
                m.Pools.Sort((a, b) => b.Active.CompareTo(a.Active));
            }
        }
        return m;
    }

    private static Dictionary<string, object> Dict(Dictionary<string, object> d, string k)
    {
        return d != null && d.ContainsKey(k) ? d[k] as Dictionary<string, object> : null;
    }

    private static string Str(Dictionary<string, object> d, string k)
    {
        return d != null && d.ContainsKey(k) && d[k] != null ? Convert.ToString(d[k], CultureInfo.InvariantCulture) : null;
    }

    private static bool? Bool(Dictionary<string, object> d, string k)
    {
        if (d == null || !d.ContainsKey(k) || d[k] == null) return null;
        if (d[k] is bool) return (bool)d[k];
        return null;
    }

    private static double? Num(Dictionary<string, object> d, string k)
    {
        if (d == null || !d.ContainsKey(k) || d[k] == null) return null;
        try { return Convert.ToDouble(d[k], CultureInfo.InvariantCulture); } catch { return null; }
    }

    private static long? Int64(Dictionary<string, object> d, string k)
    {
        double? n = Num(d, k);
        return n.HasValue ? (long?)Math.Round(n.Value) : null;
    }

    private static string MaskEmail(string email)
    {
        int at = email.IndexOf('@');
        if (at <= 0) return "•••";
        string local = email.Substring(0, at);
        string visible = local.Length <= 2 ? local.Substring(0, 1) : local.Substring(0, 2);
        return visible + "•••" + email.Substring(at);
    }

    private static string FormatPercent(double v)
    {
        double r = Math.Round(v * 10.0) / 10.0;
        if (r >= 100.0) return "100%";
        return r.ToString("0.#", CultureInfo.InvariantCulture) + "%";
    }

    private static string FormatRatio(long num, long denom)
    {
        if (denom <= 0) return "—";
        if (num >= denom) return "100%";
        double pct = (num * 100.0) / denom;
        if (num > 0 && pct < 0.05) return "<0.1%";
        return FormatPercent(Math.Min(99.9, pct));
    }

    private static string FormatTokens(long v)
    {
        long a = Math.Abs(v);
        if (a < 1000) return v.ToString(CultureInfo.InvariantCulture);
        if (a < 1000000) return (v / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + "k";
        return (v / 1000000.0).ToString("0.0", CultureInfo.InvariantCulture) + "M";
    }

    private static string FormatCountdown(string iso)
    {
        if (string.IsNullOrEmpty(iso)) return "";
        DateTime target;
        if (!DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out target)) return "";
        int mins = (int)Math.Floor((target - DateTime.UtcNow).TotalMinutes);
        if (mins < 1) return "<1m";
        if (mins < 60) return mins + "m";
        int hrs = mins / 60;
        if (hrs < 24) return hrs + "h " + (mins % 60).ToString("00", CultureInfo.InvariantCulture) + "m";
        return (hrs / 24) + "d " + (hrs % 24) + "h";
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pollTimer.Dispose();
            if (_brandIcon != null) _brandIcon.Dispose();
            _fTitle.Dispose(); _fSection.Dispose(); _fHero.Dispose(); _fMono.Dispose();
            _fBody.Dispose(); _fBold.Dispose(); _fSmall.Dispose(); _fKpi.Dispose();
        }
        base.Dispose(disposing);
    }
}
#endif
