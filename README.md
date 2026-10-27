# Git Pulse · GitLab Exposer

Aplicación local en español que visualiza y analiza la actividad de tu usuario de GitLab. Se conecta a un MCP local de GitLab y utiliza el motor original de [CatsJuice/ssr-contributions-img](https://github.com/CatsJuice/ssr-contributions-img).

## Ejecutar

Requiere Node.js 20.13 o posterior y las dependencias del MCP ya instaladas.

```powershell
git clone https://github.com/ignaciogonzalez99/gitPulse.git
cd gitPulse
npm ci
npm start
```

Abre http://localhost:4173. La primera lectura del año actual comienza automáticamente y muestra su progreso. Las lecturas posteriores se conservan en `.cache/`; pulsa **Actualizar actividad** para renovarlas. Para desarrollar: `npm run dev`.

## Conexión

Por defecto lee únicamente la configuración de `mcp_servers.gitlab` de tu archivo local de Codex (`~/.codex/config.toml`) para reutilizar su URL, token y carpeta. No copia las credenciales al proyecto ni las devuelve al navegador.

Si prefieres configuración independiente, copia `.env.example` como `.env` y define `GITLAB_MCP_PATH`, `GITLAB_URL` y `GITLAB_TOKEN`. Puedes indicar `CODEX_CONFIG_PATH` para otra configuración y `COMMIT_EMAILS` con correos adicionales verificados, separados por comas. Reinicia la aplicación después de cambiar esas opciones.

### Configurar otra computadora

El MCP de GitLab es un proyecto separado: debes tenerlo disponible con sus dependencias instaladas. Configura `GITLAB_MCP_PATH` con la carpeta que contiene su `src/server.ts` y `src/client.ts`. Si no se configura una ruta ni existe configuración de Codex, se busca en `../gitlab-mcp/gitlab-mcp`, relativa a esta aplicación.

```powershell
Copy-Item .env.example .env
```

Edita `.env` localmente con la ruta de tu MCP, la URL de tu GitLab y tu token, y ejecuta `npm start`. También puedes reutilizar una configuración local de Codex existente. Para un GitLab corporativo necesitas acceso a su red, por ejemplo mediante la VPN correspondiente.

Este repositorio no incluye credenciales ni datos de actividad. `.env`, sus variantes y `.cache/` quedan excluidos de Git; `.env.example` contiene únicamente valores de ejemplo. Conserva esa exclusión al trabajar desde otra computadora.

La aplicación inicia un cliente MCP por stdio y carga `buildServer()` del proyecto existente. Un adaptador local añade `gitlab_activity_page`, una herramienta de lectura con endpoints fijos para eventos, proyectos contribuidos, commits en todas las ramas y registros paginados. No modifica archivos del MCP, no escribe en GitLab y no permite ejecutar herramientas arbitrarias desde el navegador.

## Funciones

- Calendario, barras 3D y tendencia mensual; seis paletas.
- Filtros por año, **Todos los años** y proyecto; búsqueda y orden de proyectos.
- Búsqueda de usuarios por nombre o `@usuario`, selección de coincidencias y botón **Mis contribuciones** que vuelve al usuario autenticado del MCP. Conserva el período elegido al cambiar de usuario. Los gráficos y las exportaciones utilizan el usuario seleccionado.
- Caché separada por ID de usuario y período en `.cache/users/<id>/`; los archivos antiguos se reutilizan únicamente si pertenecen al mismo usuario.
- Vista histórica con calendarios o barras 3D apilados, comparación anual y análisis acumulado por proyecto. La primera lectura histórica consulta todo el rango disponible desde 2000; luego queda en caché y también alimenta las vistas anuales. Los comentarios están sujetos a la retención de eventos de GitLab.
- Commits propios, merge requests, issues, comentarios, días activos, racha máxima y ritmo semanal.
- Análisis por proyecto con observaciones calculadas, temas de commits y enlaces a la evidencia.
- Descargas SVG/PNG e informes Markdown/JSON por proyecto.
- Progreso de sincronización, caché local y avisos de cobertura parcial.

## Qué significan los números

Una contribución equivale a un commit, una MR creada, un issue creado o un comentario humano. El autor de los commits se atribuye por coincidencia exacta con el correo del perfil, el correo de commit o `COMMIT_EMAILS`. No se atribuyen por nombre. Los commits se leen de todas las ramas y se deduplican por SHA dentro de cada proyecto; un mismo SHA en repositorios diferentes representa actividad de cada repositorio. La fecha del commit es `committed_date` y la de MR/issues/comentarios es su creación, con zona `America/Montevideo`.

Para otros perfiles, solo se atribuyen commits por correos que GitLab permita consultar. `COMMIT_EMAILS` se aplica exclusivamente al usuario autenticado. Si un perfil oculta sus correos, la métrica de commits indica **N/D** y se informa de la cobertura parcial; MR, issues y comentarios siguen filtrándose por su ID. La búsqueda no amplía los permisos del token ni permite consultar repositorios inaccesibles.

Los pushes no se suman. Para evitar las páginas repetidas de commits observadas en esta instancia de GitLab, se filtra por correo de autor y se subdividen los intervalos de fecha cuando una respuesta está llena; se deduplican los límites por SHA. Los límites de subdivisión se señalan como cobertura parcial. Las líneas añadidas/eliminadas excluyen commits de merge y pueden volver a contar cambios que fueron revertidos o aplicados varias veces; no representan líneas netas del repositorio. Los estados de MR/issues son los actuales, incluso en informes históricos. Los temas son reglas sobre palabras en títulos, no un análisis del código ni una evaluación de calidad.

Se descubren proyectos por membresía, endpoint de proyectos contribuidos (último año) y registros de eventos/MR/issues del año seleccionado. Repositorios inaccesibles o proyectos históricos fuera de ese descubrimiento pueden faltar. GitLab puede eliminar eventos antiguos (normalmente después de tres años), y su endpoint de eventos no incluye todas las actividades de MR: las MR creadas se consultan por separado. Los comentarios disponibles no equivalen a todas las revisiones o aprobaciones. Un límite de 500 páginas por fuente se señala como lectura parcial si se alcanza. Esto no pretende reproducir exactamente el calendario nativo de GitLab ni medir productividad.

Los datos empresariales se conservan localmente, en `.cache/` (ignorada por Git), y el servidor escucha solo en `127.0.0.1`. Valida Host y Origin para proteger la API local. No está preparado para exponerse en Internet: para desplegarlo se necesita acceso al GitLab corporativo y autenticación de la aplicación.

## Verificación

```powershell
npm run check
npm test
```

Las pruebas verifican autoría, límites de fecha y zona horaria, deduplicación, rachas, métricas y renderizado real SVG calendario/3D. El motor de CatsJuice se conserva en `vendor/ssr-contributions-img/render-core`, con licencia MIT y commit de origen en `NOTICE.md`.
