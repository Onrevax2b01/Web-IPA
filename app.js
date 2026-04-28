'use strict';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const queryEl          = document.getElementById('query');
const searchBtn        = document.getElementById('searchBtn');
const loadingEl        = document.getElementById('loading');
const loadingMsg       = document.getElementById('loadingMsg');
const errorBox         = document.getElementById('errorBox');
const errorMsg         = document.getElementById('errorMsg');
const translationBox   = document.getElementById('translationBox');
const translatedQuery  = document.getElementById('translatedQuery');
const conversionBox    = document.getElementById('conversionBox');
const conversionText   = document.getElementById('conversionText');
const dciBox           = document.getElementById('dciBox');
const dciNameEl        = document.getElementById('dciName');
const meshBox          = document.getElementById('meshBox');
const meshTermsEl      = document.getElementById('meshTerms');
const filterCard       = document.getElementById('filterCard');
const resultsSection   = document.getElementById('resultsSection');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBadge     = document.getElementById('resultsBadge');
const resultsContainer = document.getElementById('resultsContainer');
const externalLink     = document.getElementById('externalLink');
const synthesisBtn       = document.getElementById('synthesisBtn');
const synthesisCard      = document.getElementById('synthesisCard');
const synthesisBadge     = document.getElementById('synthesisBadge');
const synthesisAbstracts = document.getElementById('synthesisAbstracts');
const copyBtn            = document.getElementById('copyBtn');
const copyConfirm        = document.getElementById('copyConfirm');
const claudeBtn    = document.getElementById('claudeBtn');
const claudeCard   = document.getElementById('claudeCard');
const claudeResponse = document.getElementById('claudeResponse');
const limitBox     = document.getElementById('limitBox');
const apiKeySection = document.getElementById('apiKeySection');
const apiKeyInput  = document.getElementById('apiKeyInput');
const saveKeyBtn   = document.getElementById('saveKeyBtn');
const clearKeyBtn  = document.getElementById('clearKeyBtn');

// HAS elements
const hasSearchBtn        = document.getElementById('hasSearchBtn');
const hasResultsSection   = document.getElementById('hasResultsSection');
const hasResultsTitle     = document.getElementById('hasResultsTitle');
const hasResultsBadge     = document.getElementById('hasResultsBadge');
const hasResultsContainer = document.getElementById('hasResultsContainer');
const hasClaudeBtn        = document.getElementById('hasClaudeBtn');
const hasClaudeCard       = document.getElementById('hasClaudeCard');
const hasClaudeResponse   = document.getElementById('hasClaudeResponse');

// ── State ─────────────────────────────────────────────────────────────────────

let currentPubmedQuery = '';
let currentDisplayQuery = '';
let currentArticleIds  = [];
let activeFilter       = '';
let activePeriod       = 0;

let hasDataCache      = null;
let currentHasResults = [];
let currentHasQuery   = '';
let pendingClaudeCtx  = 'pubmed'; // 'pubmed' | 'has'

// ── Constantes DCI ───────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','of','in','and','or','for','use','with','during','after','before',
  'at','by','from','to','on','an','a','is','are','was','were','have','has',
  'management','treatment','therapy','patients','patient','adults','adult',
  'role','effect','effects','impact','study','review','analysis','using',
]);


// ── Events ───────────────────────────────────────────────────────────────────

searchBtn.addEventListener('click', runSearch);
hasSearchBtn.addEventListener('click', runHasSearch);
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSearch();
});

// Filtres type d'étude
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.pt;
    applyFilters();
  });
});

// Filtres période
document.querySelectorAll('.period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activePeriod = parseInt(btn.dataset.years, 10);
    applyFilters();
  });
});

synthesisBtn.addEventListener('click', generateSynthesis);
copyBtn.addEventListener('click', copyContext);
claudeBtn.addEventListener('click', () => { pendingClaudeCtx = 'pubmed'; handleClaudeBtn(); });
hasClaudeBtn.addEventListener('click', () => { pendingClaudeCtx = 'has'; handleClaudeBtn(); });
saveKeyBtn.addEventListener('click', saveApiKey);
clearKeyBtn.addEventListener('click', () => {
  localStorage.removeItem('ipa_anthropic_key');
  apiKeyInput.value = '';
  apiKeySection.hidden = true;
  limitBox.hidden = true;
});

// Vider les anciens caches HAS
sessionStorage.removeItem('ipa_has');
sessionStorage.removeItem('ipa_has_v2');

// Pré-remplir la clé si déjà enregistrée
const storedKey = localStorage.getItem('ipa_anthropic_key');
if (storedKey) apiKeyInput.value = storedKey;

// ── Recherche principale ──────────────────────────────────────────────────────

async function runSearch() {
  const raw = queryEl.value.trim();
  if (!raw) { flashInput(); return; }
  const q = deinterrogativize(raw);

  // Réinitialiser les filtres
  activeFilter = '';
  activePeriod = 0;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.filter-btn[data-pt=""]').classList.add('active');
  document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.period-btn[data-years="0"]').classList.add('active');

  showLoading('Traduction et recherche en cours…');
  hideInfoBoxes();

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
        conversionText.textContent = dciResult.brand + ' → ' + dciResult.dci;
        conversionBox.hidden = false;
      } else {
        dciNameEl.textContent = dciResult.dci;
        dciBox.hidden = false;
      }
      searchTerm = searchTerm.replace(new RegExp(dciResult.brand, 'gi'), dciResult.dci);
    }

    // 3. Recherche PubMed + termes MeSH
    const { ids, meshTerms } = await searchPubMedWithMeSH(searchTerm);
    if (meshTerms.length > 0) showMeSHTerms(meshTerms);

    currentPubmedQuery  = searchTerm;
    currentDisplayQuery = q;
    currentArticleIds   = ids;

    // 4. Détails des articles
    const results = await getArticleDetails(ids);
    renderResults(results, searchTerm);
  } catch (err) {
    showError('Erreur : ' + (err.message || 'Impossible de contacter PubMed.'));
  }
}

// ── Filtres ───────────────────────────────────────────────────────────────────

async function applyFilters() {
  if (!currentPubmedQuery) return;
  showLoading('Application des filtres…');
  synthesisCard.hidden = true;

  try {
    let query = currentPubmedQuery;
    if (activeFilter)  query += ' AND (' + activeFilter + ')';
    if (activePeriod > 0) {
      const fromYear = new Date().getFullYear() - activePeriod;
      query += ' AND ("' + fromYear + '/01/01"[PDAT] : "3000/12/31"[PDAT])';
    }

    const { ids, meshTerms } = await searchPubMedWithMeSH(query);
    if (meshTerms.length > 0) showMeSHTerms(meshTerms);
    currentArticleIds = ids;

    const results = await getArticleDetails(ids);
    renderResults(results, query);
  } catch (err) {
    showError('Erreur lors du filtrage : ' + err.message);
  }
}

// ── Claude IA ─────────────────────────────────────────────────────────────────

function handleClaudeBtn() {
  limitBox.hidden = true;
  const ownKey = localStorage.getItem('ipa_anthropic_key');
  if (ownKey) {
    if (pendingClaudeCtx === 'has') runHasWithApiKey(ownKey);
    else runWithApiKey(ownKey);
  } else {
    if (pendingClaudeCtx === 'has') runHasWithPuter();
    else runWithPuter();
  }
}

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key.startsWith('sk-ant-')) {
    apiKeyInput.style.borderColor = '#f87171';
    setTimeout(() => { apiKeyInput.style.borderColor = ''; }, 1500);
    return;
  }
  localStorage.setItem('ipa_anthropic_key', key);
  apiKeySection.hidden = true;
  if (pendingClaudeCtx === 'has') runHasWithApiKey(key);
  else runWithApiKey(key);
}

// ── Option 1 : Puter.js (gratuit, compte Puter requis) ───────────────────────

async function runWithPuter() {
  if (currentArticleIds.length === 0) return;
  claudeBtn.disabled = true;
  claudeCard.hidden  = true;
  showLoading('Connexion à Claude gratuit via Puter…');

  try {
    await loadPuter();
    const abstracts = await fetchAbstracts(currentArticleIds.slice(0, 8));
    showLoading('Génération de la synthèse par Claude…');

    const prompt   = buildPrompt(currentDisplayQuery, abstracts);
    // puter.ai.chat retourne un objet ; le texte est dans message.content
    const res      = await puter.ai.chat(prompt, { model: 'claude-sonnet-4-5' });
    const text     = res?.message?.content?.[0]?.text
                  ?? res?.message?.content
                  ?? String(res);

    hideAll();
    resultsSection.hidden = false;
    filterCard.hidden     = false;
    claudeResponse.innerHTML = markdownToHtml(text);
    claudeCard.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    hideAll();
    resultsSection.hidden = false;
    filterCard.hidden     = false;

    const isLimit = /limit|rate|quota|429/i.test(err.message || '');
    if (isLimit) {
      limitBox.hidden     = false;
      apiKeySection.hidden = false;
      apiKeyInput.focus();
    } else {
      limitBox.hidden     = false;
      apiKeySection.hidden = false;
    }
  } finally {
    claudeBtn.disabled = false;
  }
}

function loadPuter() {
  if (window.puter) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Impossible de charger Puter.js'));
    document.head.appendChild(s);
  });
}

// ── Option 2 : Clé API Anthropic personnelle ─────────────────────────────────

async function runWithApiKey(apiKey) {
  if (currentArticleIds.length === 0) return;
  claudeBtn.disabled = true;
  claudeCard.hidden  = true;
  showLoading('Récupération des résumés et génération par Claude…');

  try {
    const abstracts = await fetchAbstracts(currentArticleIds.slice(0, 8));
    showLoading('Génération de la synthèse par Claude…');

    const prompt   = buildPrompt(currentDisplayQuery, abstracts);
    const text     = await callClaudeAPI(apiKey, prompt);

    hideAll();
    resultsSection.hidden = false;
    filterCard.hidden     = false;
    claudeResponse.innerHTML = markdownToHtml(text);
    claudeCard.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('Erreur Claude : ' + err.message);
    resultsSection.hidden = false;
    filterCard.hidden     = false;
  } finally {
    claudeBtn.disabled = false;
  }
}

async function callClaudeAPI(apiKey, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Réponse HTTP ' + res.status);
  }
  const data = await res.json();
  return data.content[0].text;
}

function buildPrompt(question, abstracts) {
  return (
    'Tu es un assistant clinique pour infirmiers en pratique avancée (IPA).\n\n' +
    'Question clinique posée : ' + question + '\n\n' +
    'Voici les résumés de ' + abstracts.length + ' études scientifiques issues de PubMed :\n\n' +
    abstracts.map((a, i) =>
      '--- Article ' + (i + 1) + ' ---\n' +
      'Titre : ' + a.title + '\n' +
      (a.journal ? 'Journal : ' + a.journal + ' (' + a.year + ')\n' : '') +
      'Résumé : ' + (a.abstract || 'Non disponible')
    ).join('\n\n') +
    '\n\n---\n' +
    'Sur la base de ces études, rédige en français une synthèse clinique structurée avec :\n' +
    '1. **Recommandations principales** issues des études\n' +
    '2. **Niveau de preuve** (fort / modéré / faible / insuffisant)\n' +
    '3. **Points de vigilance** pour la pratique infirmière avancée\n\n' +
    'Sois concis, précis et directement applicable à la pratique clinique.'
  );
}

function markdownToHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^# (.+)$/gm,   '<h3>$1</h3>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^[-•]\s+(.+)$/gm,  '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, (m) => m.startsWith('<') ? m : m)
    .split('\n').filter(l => l.trim()).join('\n');
}

// ── Synthèse clinique ─────────────────────────────────────────────────────────

async function generateSynthesis() {
  if (currentArticleIds.length === 0) return;
  synthesisBtn.disabled = true;
  synthesisCard.hidden  = true;
  showLoading('Récupération des résumés…');

  try {
    const abstracts = await fetchAbstracts(currentArticleIds.slice(0, 8));
    hideAll();
    resultsSection.hidden = false;
    filterCard.hidden     = false;
    renderSynthesis(abstracts);
  } catch (err) {
    showError('Erreur lors de la récupération des résumés : ' + err.message);
  } finally {
    synthesisBtn.disabled = false;
  }
}

async function fetchAbstracts(ids) {
  const url =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi' +
    '?db=pubmed&rettype=abstract&retmode=xml&id=' + ids.join(',');

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Erreur HTTP ' + res.status);
  const xml  = await res.text();
  const doc  = new DOMParser().parseFromString(xml, 'text/xml');

  return Array.from(doc.querySelectorAll('PubmedArticle')).map((article) => {
    const pmid    = article.querySelector('PMID')?.textContent ?? '';
    const title   = article.querySelector('ArticleTitle')?.textContent ?? 'Sans titre';
    const year    = article.querySelector('PubDate > Year')?.textContent
                 ?? article.querySelector('PubDate > MedlineDate')?.textContent?.slice(0, 4) ?? '';
    const journal = article.querySelector('Journal > Title')?.textContent ?? '';

    // Résumé — peut avoir des sections étiquetées (BACKGROUND, METHODS…)
    const abstractSections = article.querySelectorAll('AbstractText');
    let abstract = '';
    abstractSections.forEach((s) => {
      const label = s.getAttribute('Label');
      abstract += (label ? label + ' : ' : '') + s.textContent.trim() + '\n\n';
    });

    return { pmid, title, journal, year, abstract: abstract.trim() };
  });
}

function renderSynthesis(abstracts) {
  synthesisAbstracts.innerHTML = '';
  synthesisBadge.textContent   = abstracts.length + ' article' + (abstracts.length > 1 ? 's' : '');

  abstracts.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'abstract-item';

    const header = document.createElement('div');
    header.className = 'abstract-header';
    header.innerHTML =
      '<span class="abstract-title">' + escHtml(a.title) + '</span>' +
      '<span class="abstract-toggle">▼ Voir le résumé</span>';

    const body = document.createElement('div');
    body.className = 'abstract-body';
    body.textContent = a.abstract || 'Résumé non disponible.';
    body.hidden = i > 0; // premier article ouvert par défaut

    header.querySelector('.abstract-toggle').textContent = i === 0 ? '▲ Masquer' : '▼ Voir le résumé';

    header.addEventListener('click', () => {
      const open = !body.hidden;
      body.hidden = open;
      header.querySelector('.abstract-toggle').textContent = open ? '▼ Voir le résumé' : '▲ Masquer';
    });

    item.appendChild(header);
    item.appendChild(body);
    synthesisAbstracts.appendChild(item);
  });

  synthesisCard.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Copier le contexte pour IA ────────────────────────────────────────────────

async function copyContext() {
  const abstracts = Array.from(synthesisAbstracts.querySelectorAll('.abstract-item')).map((item) => {
    const title    = item.querySelector('.abstract-title').textContent;
    const abstract = item.querySelector('.abstract-body').textContent;
    return { title, abstract };
  });

  const prompt =
    'Question clinique : ' + currentDisplayQuery + '\n\n' +
    'Voici les résumés de ' + abstracts.length + ' études scientifiques pertinentes :\n\n' +
    abstracts.map((a, i) =>
      '--- Article ' + (i + 1) + ' ---\n' +
      'Titre : ' + a.title + '\n' +
      'Résumé : ' + a.abstract
    ).join('\n\n') +
    '\n\n---\n' +
    'Sur la base de ces études, fournis une synthèse clinique répondant à la question en identifiant :\n' +
    '1. Les principales recommandations\n' +
    '2. Le niveau de preuve (fort / modéré / faible)\n' +
    '3. Les points de vigilance pour la pratique infirmière avancée\n' +
    'Rédige la réponse en français.';

  try {
    await navigator.clipboard.writeText(prompt);
    copyConfirm.hidden = false;
    setTimeout(() => { copyConfirm.hidden = true; }, 2500);
  } catch {
    // Fallback : sélection manuelle
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyConfirm.hidden = false;
    setTimeout(() => { copyConfirm.hidden = true; }, 2500);
  }
}

// ── PubMed ────────────────────────────────────────────────────────────────────

async function searchPubMedWithMeSH(query) {
  const data   = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi' +
    '?db=pubmed&retmode=json&retmax=10&term=' + encodeURIComponent(query)
  );
  const result = data?.esearchresult ?? {};
  const ids    = result.idlist ?? [];
  const meshTerms = [...new Set(
    (result.translationset ?? [])
      .flatMap((t) => [...(t.to || '').matchAll(/"([^"]+)"\[MeSH Terms\]/gi)].map((m) => m[1]))
  )];
  return { ids, meshTerms };
}

async function getArticleDetails(ids) {
  if (ids.length === 0) return [];
  const data      = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi' +
    '?db=pubmed&retmode=json&id=' + ids.join(',')
  );
  const resultMap = data?.result ?? {};
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

// ── Traduction ────────────────────────────────────────────────────────────────

async function translate(text) {
  try {
    const data = await get('https://lingva.ml/api/v1/fr/en/' + encodeURIComponent(text));
    if (data?.translation) return data.translation;
  } catch { /* fallback */ }
  try {
    const data = await get(
      'https://api.mymemory.translated.net/get?langpair=fr|en&q=' + encodeURIComponent(text)
    );
    if (data?.responseData?.translatedText && data.responseStatus === 200)
      return data.responseData.translatedText;
  } catch { /* original */ }
  return text;
}

// ── DCI via RxNorm ────────────────────────────────────────────────────────────

async function findDCI(sentence) {
  const words = sentence.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

  for (const word of words.slice(0, 6)) {
    try {
      const data1 = await get(
        'https://rxnav.nlm.nih.gov/REST/rxcui.json?name=' + encodeURIComponent(word) + '&search=2'
      );
      const rxcui = data1?.idGroup?.rxnormId?.[0];
      if (!rxcui) continue;

      const data2 = await get(
        'https://rxnav.nlm.nih.gov/REST/rxcui/' + rxcui + '/related.json?tty=IN'
      );
      const groups   = data2?.relatedGroup?.conceptGroup ?? [];
      const ingGroup = groups.find((g) => g.tty === 'IN' && g.conceptProperties?.length > 0);
      if (ingGroup) return { brand: word, dci: ingGroup.conceptProperties[0].name };
    } catch { continue; }
  }
  return null;
}

// ── Rendu résultats ───────────────────────────────────────────────────────────

function renderResults(results, pubmedQuery) {
  hideAll();

  resultsTitle.textContent = 'Résultats PubMed';
  resultsBadge.textContent = results.length + ' résultat' + (results.length !== 1 ? 's' : '');
  externalLink.href        = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(pubmedQuery);
  externalLink.textContent = 'Voir tous les résultats sur PubMed →';

  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML =
      '<p style="color:var(--muted);font-size:.9rem">Aucun résultat. Essayez d\'autres mots-clés ou retirez des filtres.</p>';
  } else {
    results.forEach((r) => resultsContainer.appendChild(buildCard(r)));
  }

  filterCard.hidden     = false;
  resultsSection.hidden = false;
}

function buildCard(r) {
  const card = document.createElement('div');
  card.className = 'result-item';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  const a = document.createElement('a');
  a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.textContent = r.title;
  titleEl.appendChild(a);
  card.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  [r.journal, r.year].filter(Boolean).forEach((label) => {
    const tag = document.createElement('span');
    tag.className = 'tag'; tag.textContent = label;
    meta.appendChild(tag);
  });
  if (meta.childNodes.length) card.appendChild(meta);

  if (r.authors) {
    const auth = document.createElement('p');
    auth.className = 'result-meta'; auth.textContent = r.authors;
    card.appendChild(auth);
  }

  const link = document.createElement('a');
  link.className = 'result-link'; link.href = r.url;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = 'Lire sur PubMed →';
  card.appendChild(link);

  return card;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function showLoading(msg) {
  hideAll();
  loadingMsg.textContent = msg || 'Recherche en cours…';
  loadingEl.hidden = false;
}

function hideAll() {
  loadingEl.hidden         = true;
  errorBox.hidden          = true;
  resultsSection.hidden    = true;
  filterCard.hidden        = true;
  synthesisCard.hidden     = true;
  claudeCard.hidden        = true;
  hasResultsSection.hidden = true;
  hasClaudeCard.hidden     = true;
}

function hideInfoBoxes() {
  translationBox.hidden = true;
  conversionBox.hidden  = true;
  dciBox.hidden         = true;
  meshBox.hidden        = true;
}

function showError(msg) {
  hideAll();
  errorMsg.textContent = msg;
  errorBox.hidden = false;
}

function flashInput() {
  queryEl.style.borderColor = '#f87171';
  queryEl.focus();
  setTimeout(() => { queryEl.style.borderColor = ''; }, 1200);
}

function showMeSHTerms(terms) {
  meshTermsEl.innerHTML = '';
  terms.forEach((term) => {
    const tag = document.createElement('span');
    tag.className = 'mesh-tag'; tag.textContent = term;
    meshTermsEl.appendChild(tag);
  });
  meshBox.hidden = false;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function get(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Réponse HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé (10 s).');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Réponse HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Désinterrogativisation ────────────────────────────────────────────────────

function deinterrogativize(text) {
  let q = text.trim().replace(/\s*\?+\s*$/, '');

  const patterns = [
    /^qu['']est-ce\s+qu['']?\s*/i,
    /^qu['']est-ce\s+que\s+/i,
    /^est-ce\s+qu['']?\s*/i,
    /^est-ce\s+que\s+/i,
    /^quelles\s+sont\s+(les\s+|l[''])?/i,
    /^quels\s+sont\s+(les\s+|l[''])?/i,
    /^quelle\s+est\s+(la\s+|l['']|le\s+)?/i,
    /^quel\s+est\s+(la\s+|l['']|le\s+)?/i,
    /^quelle\s+/i,
    /^quels?\s+/i,
    /^comment\s+(faire\s+pour\s+|gérer\s+|traiter\s+|prendre\s+en\s+charge\s+)?/i,
    /^pourquoi\s+/i,
    /^quand\s+/i,
    /^y\s+a-t-il\s+/i,
    /^dans\s+quel\s+cas\s+/i,
  ];

  for (const p of patterns) {
    if (p.test(q)) { q = q.replace(p, ''); break; }
  }

  return q.charAt(0).toUpperCase() + q.slice(1);
}

// ── HAS Search via LiSSa ─────────────────────────────────────────────────────

const LISSA_URL = 'https://www.lissa.fr/dc/elements/';

async function runHasSearch() {
  const raw = queryEl.value.trim();
  if (!raw) { flashInput(); return; }

  const q = deinterrogativize(raw);
  currentHasQuery = q;

  showLoading('Recherche dans les recommandations HAS via LiSSa…');
  hideInfoBoxes();

  try {
    const results = await searchLissa(q);
    renderHasResults(results, q);
  } catch (err) {
    showError('Erreur LiSSa : ' + err.message);
  }
}

async function searchLissa(query) {
  const url = LISSA_URL + '?query=' + encodeURIComponent(query) + '&nb=10';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Réponse HTTP ' + res.status);

    const text = await res.text();

    // LiSSa renvoie du XML — on parse
    if (text.trim().startsWith('<')) {
      return parseLissaXML(text);
    }
    // Fallback JSON
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : (data.items || data.results || []);
  } finally {
    clearTimeout(timer);
  }
}

function parseLissaXML(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = doc.querySelectorAll('item, record, element, result, doc');
  if (!items.length) return [];

  return Array.from(items).map(el => {
    const get = tag => el.querySelector(tag)?.textContent?.trim() || '';
    return {
      title:  get('title') || get('titre') || get('name') || get('dc\:title') || 'Sans titre',
      url:    get('link')  || get('url')   || get('uri')  || get('dc\:identifier') || '',
      source: get('source')|| get('journal')|| get('dc\:source') || '',
      date:   get('date')  || get('year')  || get('dc\:date') || '',
      type:   get('type')  || get('dc\:type') || '',
    };
  });
}

function renderHasResults(results, query) {
  hideAll();

  hasResultsTitle.textContent  = 'Recommandations — LiSSa';
  hasResultsBadge.textContent  = results.length + ' résultat' + (results.length !== 1 ? 's' : '');
  currentHasResults = results;
  hasResultsContainer.innerHTML = '';

  if (results.length === 0) {
    // Fallback : lien direct vers HAS
    hasResultsContainer.innerHTML =
      '<p style="color:var(--muted);font-size:.9rem">Aucun résultat LiSSa. ' +
      '<a href="https://www.has-sante.fr/jcms/fc_1249603/fr/recherche?text=' +
      encodeURIComponent(query) + '" target="_blank" rel="noopener" style="color:#0e7490;font-weight:600">' +
      'Rechercher directement sur has-sante.fr →</a></p>';
  } else {
    results.forEach(r => hasResultsContainer.appendChild(buildHasCard(r)));
  }

  hasResultsSection.hidden = false;
  hasResultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildHasCard(r) {
  const title  = r.title  || r['titre_fr'] || r['titre'] || 'Sans titre';
  const url    = r.url    || r['lien'] || '';
  const source = r.source || r['type_de_publication'] || '';
  const date   = r.date   || r['date_de_mise_en_ligne'] || '';

  const card = document.createElement('div');
  card.className = 'has-result-item';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  if (url) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = title;
    titleEl.appendChild(a);
  } else {
    titleEl.textContent = title;
  }
  card.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  [source, date].filter(Boolean).forEach(label => {
    const tag = document.createElement('span');
    tag.className = 'tag'; tag.textContent = label;
    meta.appendChild(tag);
  });
  if (meta.childNodes.length) card.appendChild(meta);

  if (url) {
    const link = document.createElement('a');
    link.className = 'result-link'; link.href = url;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'Lire le document →';
    card.appendChild(link);
  }

  return card;
}

// ── Claude HAS ────────────────────────────────────────────────────────────────

async function runHasWithPuter() {
  if (!currentHasResults.length) return;
  hasClaudeBtn.disabled = true;
  hasClaudeCard.hidden  = true;
  showLoading('Connexion à Claude gratuit via Puter…');

  try {
    await loadPuter();
    showLoading('Génération de la synthèse HAS par Claude…');
    const prompt = buildHasPrompt(currentHasQuery, currentHasResults);
    const res    = await puter.ai.chat(prompt, { model: 'claude-sonnet-4-5' });
    const text   = res?.message?.content?.[0]?.text ?? res?.message?.content ?? String(res);

    hideAll();
    hasResultsSection.hidden = false;
    hasClaudeResponse.innerHTML = markdownToHtml(text);
    hasClaudeCard.hidden = false;
    hasResultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    hideAll();
    hasResultsSection.hidden = false;
    limitBox.hidden      = false;
    apiKeySection.hidden = false;
    apiKeyInput.focus();
  } finally {
    hasClaudeBtn.disabled = false;
  }
}

async function runHasWithApiKey(apiKey) {
  if (!currentHasResults.length) return;
  hasClaudeBtn.disabled = true;
  hasClaudeCard.hidden  = true;
  showLoading('Génération de la synthèse HAS par Claude…');

  try {
    const prompt = buildHasPrompt(currentHasQuery, currentHasResults);
    const text   = await callClaudeAPI(apiKey, prompt);

    hideAll();
    hasResultsSection.hidden = false;
    hasClaudeResponse.innerHTML = markdownToHtml(text);
    hasClaudeCard.hidden = false;
    hasResultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('Erreur Claude : ' + err.message);
    hasResultsSection.hidden = false;
  } finally {
    hasClaudeBtn.disabled = false;
  }
}

function buildHasPrompt(question, results) {
  return (
    'Tu es un assistant clinique pour infirmiers en pratique avancée (IPA).\n\n' +
    'Question clinique : ' + question + '\n\n' +
    'Voici les recommandations de la HAS (Haute Autorité de Santé) trouvées :\n\n' +
    results.slice(0, 8).map((r, i) => {
      const title = r['title'] || r['label'] || r['titre_fr'] || r['titre'] || r['nom'] || 'Sans titre';
      const type  = r['type'] || r['typeName'] || r['type_de_publication'] || '';
      const date  = r['pdate'] || r['date_de_mise_en_ligne'] || r['date'] || '';
      const theme = r['category'] || r['thematique'] || r['domaine'] || '';
      return (
        '--- Recommandation ' + (i + 1) + ' ---\n' +
        'Titre : ' + title + '\n' +
        (type  ? 'Type : ' + type + '\n'         : '') +
        (date  ? 'Date : ' + date + '\n'         : '') +
        (theme ? 'Thématique : ' + theme + '\n'  : '')
      );
    }).join('\n') +
    '\n\n---\n' +
    'Sur la base de ces recommandations HAS, rédige en français une synthèse clinique avec :\n' +
    '1. **Points clés des recommandations HAS** applicables à la question\n' +
    '2. **Implications pour la pratique infirmière avancée**\n' +
    '3. **Points de vigilance** importants\n\n' +
    'Sois concis, précis et directement applicable à la pratique clinique.'
  );
}
