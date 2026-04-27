'use strict';

const queryEl          = document.getElementById('query');
const searchBtn        = document.getElementById('searchBtn');
const loadingEl        = document.getElementById('loading');
const errorBox         = document.getElementById('errorBox');
const errorMsg         = document.getElementById('errorMsg');
const resultsSection   = document.getElementById('resultsSection');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBadge     = document.getElementById('resultsBadge');
const resultsContainer = document.getElementById('resultsContainer');
const externalLink     = document.getElementById('externalLink');
const translationBox   = document.getElementById('translationBox');
const translatedQuery  = document.getElementById('translatedQuery');
const meshBox          = document.getElementById('meshBox');
const meshTermsEl      = document.getElementById('meshTerms');
const dciBox           = document.getElementById('dciBox');
const dciNameEl        = document.getElementById('dciName');
const conversionBox    = document.getElementById('conversionBox');
const conversionText   = document.getElementById('conversionText');

searchBtn.addEventListener('click', runSearch);
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSearch();
});

async function runSearch() {
  const q = queryEl.value.trim();
  if (!q) { flashInput(); return; }

  showLoading();
  translationBox.hidden = true;
  dciBox.hidden         = true;
  conversionBox.hidden  = true;
  meshBox.hidden        = true;

  try {
    // 1. Traduction FR → EN
    const english = await translate(q);
    if (english && english.toLowerCase() !== q.toLowerCase()) {
      translatedQuery.textContent = english;
      translationBox.hidden = false;
    }

    // 2. DCI : identifier le principe actif mot par mot
    let searchTerm = english || q;
    const dciResult = await findDCI(searchTerm);
    if (dciResult) {
      const isBrandConversion = dciResult.dci.toLowerCase() !== dciResult.brand.toLowerCase();
      if (isBrandConversion) {
        // Boîte rouge : nom commercial remplacé
        conversionText.textContent = dciResult.brand + ' → ' + dciResult.dci;
        conversionBox.hidden = false;
      } else {
        // Boîte violette : principe actif déjà générique
        dciNameEl.textContent = dciResult.dci;
        dciBox.hidden = false;
      }
      searchTerm = searchTerm.replace(new RegExp(dciResult.brand, 'gi'), dciResult.dci);
    }

    // 3. Recherche PubMed — récupère IDs + termes MeSH traduits par PubMed lui-même
    const { ids, meshTerms } = await searchPubMedWithMeSH(searchTerm);
    if (meshTerms.length > 0) showMeSHTerms(meshTerms);

    // 4. Détails des articles
    const results = await getArticleDetails(ids);
    renderResults(results, english || q, searchTerm);
  } catch (err) {
    showError('Erreur : ' + (err.message || 'Impossible de contacter PubMed. Vérifiez votre connexion.'));
  }
}

// ── DCI : cherche un nom commercial mot par mot via RxNorm ───────────────────

const STOP_WORDS = new Set([
  'the','of','in','and','or','for','use','with','during','after','before',
  'at','by','from','to','on','an','a','is','are','was','were','have','has',
  'management','treatment','therapy','patients','patient','adults','adult',
  'role','effect','effects','impact','study','review','analysis','using',
]);

async function findDCI(sentence) {
  const words = sentence.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

  for (const word of words.slice(0, 6)) {
    try {
      // Étape 1 : obtenir le RxCUI (identifiant unique RxNorm)
      const data1 = await get(
        'https://rxnav.nlm.nih.gov/REST/rxcui.json?name=' + encodeURIComponent(word) + '&search=2'
      );
      const rxcui = data1?.idGroup?.rxnormId?.[0];
      if (!rxcui) continue;

      // Étape 2 : obtenir le principe actif (TTY=IN) lié au RxCUI
      const data2 = await get(
        'https://rxnav.nlm.nih.gov/REST/rxcui/' + rxcui + '/related.json?tty=IN'
      );
      const groups   = data2?.relatedGroup?.conceptGroup ?? [];
      const ingGroup = groups.find((g) => g.tty === 'IN' && g.conceptProperties?.length > 0);

      if (ingGroup) {
        return { brand: word, dci: ingGroup.conceptProperties[0].name };
      }
    } catch { continue; }
  }
  return null;
}

// ── PubMed search + MeSH via translationset (1 seul appel API) ───────────────
// PubMed retourne dans translationset les termes MeSH qu'il utilise lui-même

async function searchPubMedWithMeSH(query) {
  const data = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi' +
    '?db=pubmed&retmode=json&retmax=10&term=' + encodeURIComponent(query)
  );
  const result = data?.esearchresult ?? {};
  const ids    = result.idlist ?? [];

  // Extraire les noms MeSH depuis les entrées comme "Aspirin"[MeSH Terms]
  const meshTerms = [...new Set(
    (result.translationset ?? [])
      .flatMap((t) => [...(t.to || '').matchAll(/"([^"]+)"\[MeSH Terms\]/gi)].map((m) => m[1]))
  )];

  return { ids, meshTerms };
}

async function getArticleDetails(ids) {
  if (ids.length === 0) return [];
  const summaryData = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi' +
    '?db=pubmed&retmode=json&id=' + ids.join(',')
  );
  const resultMap = summaryData?.result ?? {};
  return ids.map((id) => {
    const item = resultMap[id];
    if (!item || typeof item !== 'object') return null;
    return {
      id,
      title:   item.title   || 'Sans titre',
      journal: item.source  || '',
      year:    (item.pubdate || '').slice(0, 4),
      authors: (item.authors ?? []).slice(0, 5).map((a) => a.name).join(', '),
      url:     'https://pubmed.ncbi.nlm.nih.gov/' + id + '/',
    };
  }).filter(Boolean);
}

function showMeSHTerms(terms) {
  meshTermsEl.innerHTML = '';
  terms.forEach((term) => {
    const tag = document.createElement('span');
    tag.className   = 'mesh-tag';
    tag.textContent = term;
    meshTermsEl.appendChild(tag);
  });
  meshBox.hidden = false;
}

// ── Traduction FR → EN ───────────────────────────────────────────────────────
// Priorité : Lingva (moteur Google Translate, meilleure qualité médicale)
// Fallback  : MyMemory si Lingva est indisponible

async function translate(text) {
  // 1. Lingva Translate — qualité Google Translate, sans clé API
  try {
    const data = await get(
      'https://lingva.ml/api/v1/fr/en/' + encodeURIComponent(text)
    );
    const translation = data?.translation;
    if (translation) return translation;
  } catch { /* fallback */ }

  // 2. MyMemory — fallback
  try {
    const data = await get(
      'https://api.mymemory.translated.net/get?langpair=fr|en&q=' + encodeURIComponent(text)
    );
    const translation = data?.responseData?.translatedText;
    if (translation && data.responseStatus === 200) return translation;
  } catch { /* recherche en texte original */ }

  return text;
}

// Fetch simple avec timeout 10s
async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Réponse HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé (10 s). Vérifiez votre connexion.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Rendu ────────────────────────────────────────────────────────────────────

function renderResults(results, displayQuery, pubmedQuery) {
  hideAll();

  resultsTitle.textContent  = 'Résultats PubMed';
  resultsBadge.textContent  = results.length + ' résultat' + (results.length !== 1 ? 's' : '');
  externalLink.href         = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(pubmedQuery || displayQuery);
  externalLink.textContent  = 'Voir tous les résultats sur PubMed →';

  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML =
      '<p style="color:var(--muted);font-size:.9rem">Aucun résultat. Essayez en anglais ou avec d\'autres mots-clés.</p>';
  } else {
    results.forEach((r) => resultsContainer.appendChild(buildCard(r)));
  }

  resultsSection.hidden = false;
}

function buildCard(r) {
  const card = document.createElement('div');
  card.className = 'result-item';

  // Titre + lien
  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  const a = document.createElement('a');
  a.href   = r.url;
  a.target = '_blank';
  a.rel    = 'noopener noreferrer';
  a.textContent = r.title;
  titleEl.appendChild(a);
  card.appendChild(titleEl);

  // Journal · année
  const meta = document.createElement('div');
  meta.className = 'result-meta';
  [r.journal, r.year].filter(Boolean).forEach((label) => {
    const tag = document.createElement('span');
    tag.className   = 'tag';
    tag.textContent = label;
    meta.appendChild(tag);
  });
  if (meta.childNodes.length) card.appendChild(meta);

  // Auteurs
  if (r.authors) {
    const auth = document.createElement('p');
    auth.className   = 'result-meta';
    auth.textContent = r.authors;
    card.appendChild(auth);
  }

  // Lien
  const link = document.createElement('a');
  link.className   = 'result-link';
  link.href        = r.url;
  link.target      = '_blank';
  link.rel         = 'noopener noreferrer';
  link.textContent = 'Lire sur PubMed →';
  card.appendChild(link);

  return card;
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function showLoading() {
  resultsSection.hidden = true;
  errorBox.hidden       = true;
  loadingEl.hidden      = false;
}

function hideAll() {
  loadingEl.hidden      = true;
  errorBox.hidden       = true;
  resultsSection.hidden = true;
}

function showError(msg) {
  hideAll();
  errorMsg.textContent = msg;
  errorBox.hidden      = false;
}

function flashInput() {
  queryEl.style.borderColor = '#f87171';
  queryEl.focus();
  setTimeout(() => { queryEl.style.borderColor = ''; }, 1200);
}
