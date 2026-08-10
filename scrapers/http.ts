import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";

/** Contador de reintentos por request (de la librería). */
declare module "axios" {
  interface AxiosRequestConfig {
    __retryCount?: number;
  }
}

/**
 * Cliente HTTP compartido por todas las fuentes.
 * - Timeouts generosos (los sitios de fútbol suelen ser lentos).
 * - User-Agent de navegador para evitar bloqueos triviales.
 * - Header Accept-Language es.
 * - Reintentos solo ante errores de red (ETIMEDOUT / ECONNRESET / 5xx en
 *   respuestas GET), nunca ante respuestas 4xx (evitamos golpear URLs que
 *   la fuente considera inexistentes).
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export interface FetchOptions {
  /** true cuando se espera HTML (por defecto). */
  html?: boolean;
  /** Override del timeout (ms). */
  timeoutMs?: number;
  /** Parámetros de query extra. */
  params?: Record<string, string | number>;
  /**
   * Codificación del body. Por defecto utf-8. Algunos endpoints AJAX de estas
   * fuentes sirven en ISO-8859-1 (windows-1252); decodificar mal rompe tildes.
   */
  encoding?: "utf-8" | "windows-1252";
}

export function createHttpClient(baseUrl: string): AxiosInstance {
  const client = axios.create({
    baseURL: baseUrl,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    maxRedirects: 5,
  });

  client.interceptors.response.use(
    (res) => res,
    (error: AxiosError) => {
      if (error.response) {
        // Respuesta HTTP del server: no reintentar 4xx.
        if (error.response.status >= 400 && error.response.status < 500) {
          return Promise.reject(error);
        }
      }
      // Errores de red/5xx: reintentar.
      const cfg = (error.config ?? {}) as AxiosRequestConfig;
      cfg.__retryCount = (cfg.__retryCount ?? 0) + 1;
      if (cfg.__retryCount > MAX_RETRIES) {
        return Promise.reject(error);
      }
      return new Promise((resolve) => setTimeout(resolve, 800)).then(() =>
        client.request(cfg),
      );
    },
  );

  return client;
}

/** GET simple devolviendo `text/html`. Lanza el error de axios sin tragarse
 *  nada: quien llame decide cómo (Source Down) reacionar. */
export async function fetchHtml(client: AxiosInstance, path: string, opts: FetchOptions = {}) {
  const config: AxiosRequestConfig = {
    url: path,
    method: "GET",
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    params: opts.params,
    responseType: "arraybuffer",
  };
  const res = await client.request<ArrayBuffer>(config);
  return decodeBody(res.data, opts.encoding ?? "utf-8");
}

/** POST con body urlencoded (patrón común en endpoints AJAX de estas fuentes). */
export async function postForm(
  client: AxiosInstance,
  path: string,
  body: Record<string, string | number>,
  opts: FetchOptions = {},
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, String(v));

  const res = await client.request<ArrayBuffer>({
    url: path,
    method: "POST",
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    data: params.toString(),
    responseType: "arraybuffer",
  });
  return decodeBody(res.data, opts.encoding ?? "utf-8");
}

function decodeBody(data: ArrayBuffer, encoding: "utf-8" | "windows-1252"): string {
  return new TextDecoder(encoding).decode(data);
}