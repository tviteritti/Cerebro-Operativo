# Cerebro Operativo

Internal app for **projects** + **operational context** with local LLM (Ollama) and semantic search (PostgreSQL + **pgvector**). Backend: **NestJS**. Frontend: **React + Vite + Tailwind**.

App interna para **proyectos** + **contexto operativo** con IA local (Ollama) y búsqueda semántica (PostgreSQL + **pgvector**). Backend en **NestJS**, frontend en **React + Vite + Tailwind**.

## Requisitos

- [Docker](https://www.docker.com/) (Base de datos + Ollama + backend en contenedor)
- [Node.js 20+](https://nodejs.org/) (frontend y/o backend en modo desarrollo)
- (Opcional) [Ollama](https://ollama.com/) instalado en el host si no usas el contenedor y quieres los mismos puertos que en `backend/.env`

**Antes de arrancar:**

```bash
cp .env.example .env
cp backend/.env.example backend/.env
# editá POSTGRES_PASSWORD, JWT_SECRET y SEED_* en ambos
```

## Puesta en marcha rápida

### 1. Infra con Docker (raíz del repo)

```bash
docker compose up -d
```

- **API:** `http://localhost:3000` (prefijo: `/api`)
- **Base de datos:** `localhost:5433` (usuario/DB según `.env`; defaults `cerebro` / `cerebro_operativo`)
- **Ollama:** `http://localhost:11434`

La **primera vez** en una máquina, descarga en Ollama los modelos usados (por defecto en compose: `llama3.2` y `nomic-embed-text`):

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

*(Dentro del stack de Docker, el contenedor de Ollama acepta pulls desde el host o puedes `docker exec -it cerebro-ollama ollama pull ...` según tu setup.)*

### 2. Frontend (terminal aparte)

```bash
cd frontend
npm install
npm run dev
```

- UI: `http://localhost:5173`
- Vite hace **proxy** de `/api` → `http://localhost:3000`

**Chats (hilos) y 404:** si en el navegador falla `GET /api/ia/.../chats` con **404**, el servicio en el puerto 3000 es una **imagen antigua** o un `dist` sin recompilar. Reconstruí el backend: `docker compose build backend && docker compose up -d backend`. En desarrollo solo con Node: `cd backend && npm run build && npm run start:dev` (y dejá el API en 3000 para el proxy de Vite).

### 3. Usuarios iniciales (obligatorio si la DB está vacía)

El seed **no** corre al arrancar. Con la base levantada y el `backend/.env` apuntando a la misma DB que Docker:

```bash
cd backend
npm install
npm run seed
```

| Rol    | Email                   | Contraseña (default) |
|--------|-------------------------|----------------------|
| Admin  | `admin@miempresa.com`   | valor de `SEED_ADMIN_PASSWORD` (default `changeme`) |
| Usuario| `usuario@miempresa.com` | valor de `SEED_USER_PASSWORD` (default `changeme`) |

*(Definilos en `backend/.env` / `.env` antes del primer seed.)*

### 4. Desarrollo: backend en local en lugar del contenedor

Detén o no levantes el servicio `backend` en Docker y en `backend/.env` usa al menos: `DB_HOST=localhost`, `DB_PORT=5433`, y `OLLAMA_BASE_URL=http://localhost:11434`. Luego:

```bash
cd backend
npm install
npm run start:dev
```

**Registro:** solo correos cuyo dominio coincida con `ALLOWED_EMAIL_DOMAIN` en `backend/.env` (p. ej. `usuario@miempresa.com`).

## Proyecto: URLs, Git e indexado

- **Enlaces de referencia:** lista de pares **título + URL** (staging, Jira, docs…); solo enriquecen el contexto del RAG, no ejecutan Git.
- **Repositorio Git:** **una** URL https del código (sin token), la **rama** y el botón **Sincronizar** / opción al indexar para hacer pull en el servidor.
- **Ruta local (opcional):** solo si querés que `git pull` use una carpeta ya existente en tu máquina; si solo configurás la URL remota, el proyecto se descarga en el servidor sin necesitar esa ruta.
- **Sincronizar repositorio** hace `git pull` (o clon bajo el directorio de trabajo). En el **servidor**, el clon vive en un volumen (`GIT_CLONE_BASE_PATH` en Docker: `/data/git-workspaces`) y el acceso a repos **privados** se hace con un **PAT** en el entorno del host: `GIT_PERSONAL_ACCESS_TOKEN` (no se guarda en la base de la app). En `docker compose` se puede inyectar con un `.env` en la raíz del repo o con variables del sistema.
- **Indexar** incluye descripción, contexto, enlaces y, si hay un repositorio sincronizado, un **muestreo de archivos de código** para el RAG. Podés marcar **sincronizar Git antes de indexar** para traer el último commit y luego generar los embeddings.
- **Local vs servidor:** en local, `git` tiene que existir en el `PATH` y, si usás ruta al clon, `ALLOW_ABSOLUTE_LOCAL_REPO=true` (por defecto) permite carpetas fuera del directorio de clon; en el contenedor de producción normalmente se usa `false` y solo el clon bajo el volumen.

## Estructura del repo

```
backend/     # NestJS, API bajo /api
frontend/    # React + Vite
db-init/     # SQL inicial (extensiones, etc.)
docker-compose.yml
```

## Notas

- CORS en el API permite origen `http://localhost:5173`.
- TypeORM con `synchronize: true` está pensado para **desarrollo**; en producción conviene migraciones y `synchronize: false`.
