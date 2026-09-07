# pi-copy-snippet

Extensión de pi que muestra los bloques de código de la última respuesta como ventanas con título, lenguaje, número de líneas y una vista previa con resaltado de sintaxis. Permite copiarlos mediante un selector de teclado o haciendo clic en fullscreen.

## Desarrollo

```bash
npm install
npm run typecheck
pi -e .
```

Usar `pi -e .` valida y carga el directorio como paquete mediante el manifiesto `pi.extensions` de `package.json`.

Después de una respuesta con bloques Markdown aparecerá una ventana por snippet. Cada una muestra hasta cinco líneas; si el bloque es mayor, indica cuántas líneas se han omitido.

La forma recomendada de usarlo es pulsar `Ctrl+S`: se abrirá un selector que se maneja con las flechas, `Enter` y `Esc`. En macOS es la tecla Control (`⌃`), no Command (`⌘`). También puedes ejecutar:

```text
/copy-snippet     # abre el selector si hay varios snippets
/copy-snippet 2   # copia directamente el segundo
```

El clic sobre una fila funciona cuando pi se ejecuta en modo fullscreen:

```bash
pi --tui-mode fullscreen -e .
```

En el modo TUI normal el terminal conserva el ratón para seleccionar texto y hacer scroll, por lo que los widgets no reciben los clics.

En macOS usa `pbcopy`; en Linux usa `wl-copy` (Wayland) o `xclip` (X11); en Windows usa PowerShell.

## Instalación como paquete pi

Añade este directorio como paquete local o publica el paquete en npm. La entrada está declarada en el campo `pi.extensions` de `package.json`.
