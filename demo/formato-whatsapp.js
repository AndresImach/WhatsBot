(function (global) {
  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatearWhatsApp(txt) {
    let s = String(txt ?? "").replace(/\r\n?/g, "\n");
    const tokens = [];
    const guardar = (html) => `\uE000${tokens.push(html) - 1}\uE001`;

    // El monoespaciado protege su contenido: adentro no se interpretan
    // asteriscos, guiones bajos, enlaces ni ningún otro formato.
    s = s.replace(/```([\s\S]*?)```/g, (_, contenido) => {
      const limpio = contenido.replace(/^\n|\n$/g, "");
      return guardar(`<pre><code>${escHtml(limpio)}</code></pre>`);
    });
    s = s.replace(/`([^`\n]+)`/g, (_, contenido) => guardar(`<code>${escHtml(contenido)}</code>`));

    // WhatsApp no interpreta enlaces ni imágenes Markdown. Conservamos todos
    // sus signos literalmente y volvemos clickeable solamente la URL visible.
    s = s.replace(/https?:\/\/[^\s<>"'`]+/g, (urlConPuntuacion) => {
      const partes = urlConPuntuacion.match(/^(.*?)([.,;:!?)}\]]*)$/);
      const url = partes?.[1] || urlConPuntuacion;
      const puntuacion = partes?.[2] || "";
      return guardar(`<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${escHtml(url)}</a>`) + puntuacion;
    });

    s = escHtml(s);
    // WhatsApp usa *un solo asterisco*. Con **doble**, interpreta el par
    // interior y deja visibles los dos asteriscos exteriores.
    s = s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
    s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
    s = s.replace(/~([^~\n]+)~/g, "<s>$1</s>");
    s = s.replace(/(^|\n)&gt;\s?([^\n]+)/g, "$1<blockquote>$2</blockquote>");

    return s.replace(/\uE000(\d+)\uE001/g, (_, i) => tokens[Number(i)] || "");
  }

  global.formatearWhatsApp = formatearWhatsApp;
})(window);
