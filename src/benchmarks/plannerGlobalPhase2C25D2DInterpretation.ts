/**
 * Issue #154 Phase 2-C2.5-D2-d: the written interpretation of the formal run (post-hoc, allowlisted by the analyzer).
 * It contains text only and changes no calculation; the numbers it states are the ones the analyzer derived from the
 * raw run of measured HEAD `aebe6bbb2e52ca59641fb70b25754de0a76b78c5` and the committed D2-a / D2-c RESULTs.
 */
export const PHASE2C25D2D_INTERPRETATION = {
  outcomeCategory: 'A: 両primary（c12-p0#0 / c2-p1#0）とも両modeでOOMを脱し、20分budget内に正常終了した',
  formalConclusions: [
    'H1（held-aware Bonus streamのpast depth raw solution保持の廃止）後、D2-aで両modeともout_of_memoryだったprimary 2件は、Node 8 GB・20分budgetで両modeとも正常終了した（OOM脱出 2 / 2）。',
    'c12-p0#0は両modeでstopped_by_extent_before_candidate（minimal 867.6 s、instrumented 903.0 s、Gogma depth 234、累積Gogma generated 125,904,312）。Candidateはextent内に無かった。これは新規観測であり、D2-aとのCandidate parityではない。',
    'c2-p1#0は両modeでfirst_candidate（minimal 305.7 s、instrumented 314.9 s、Gogma depth 63、累積Gogma generated 55,433,083、first Candidate key SHA-256 fffec72a…115c が両modeで一致）。これも新規観測である。',
    'sampled max heapUsedはc12が6.62 / 6.64 GiB（D2-a、OOM前）→ 4.35 / 4.42 GiB（D2-d、完走）、c2が6.59 / 6.62 GiB → 1.34 / 1.29 GiB（minimal / instrumented）。D2-dの値は完走までの全期間のsampled maximumで、D2-aの値はOOM前の最後までのsampled maximumである。',
    'cleared reference c0-p0#0と完了control 2件（c8-p1#0 / c13-p4#0）は、両modeでD2-aとstatus・Search summary・first Candidate key SHA-256・extent / exhausted・instrumented prediction counts・累積Gogma generated / frontierが完全一致した（semantic parity 3 / 3 context、mode間parity失敗 0）。c0-p0#0のsampled max heapUsedは4.19 / 4.17 GiB → 0.79 / 0.73 GiBになった。',
    'Candidate semanticsは不変: PR #173の48 Candidate baseline、D2-aの33 pattern pre-D2 parity、pre-D2-d実装で一度だけ記録したheld-aware Bonus stream 11 caseのgolden（raw solution・順序・steps・history・notice・exhausted・extent・prediction）を期待値変更なしでpassした（measured HEADのVitest 5,119 tests passed、failure 0）。',
    'measured HEADのbonusStream.tsはReservedSetにraw solution collectionを持たず、readReservedDepth()はdepths collectionを読まない（D2-c measured HEADではどちらもtrue）。ordinaryの readDepth() / solve() cacheと全raw solutionの steps[] 構築（H2未実装）はそのまま残っている。',
  ],
  h1Effect: [
    'H1で消えたのは「読み終えたdepthのraw solutionを全件保持し続ける」構造である。D2-aでは累積generated state数に比例してheapが増え約17.3〜17.4 M stateでOOMしたが、D2-dではc12が約1.26億state、c2が約5,543万stateを生成してもsampled max heapUsedは4.42 GiB以下だった。',
    'D2-dのheapは単調増加せず、1 depthのgenerated burst（最大1,964,741 state / depth、8 stream合算の同depth値はD2-aと同一）とfrontier / result historyの成長に応じて上下した（c12 instrumentedのsnapshot列の10%刻み抜粋で0.50〜3.15 GiB、全sampleのsampled maximumは4.42 GiB）。',
    '到達depthと生成量が大きく異なるため、「set.depthsを消してX GiB削減した」という単純差分は主張しない。',
  ],
  notYetClaimable: [
    'Browser（Chrome Dedicated Worker）でOOM / renderer lossが解消したとは言えない（今回Browserは測定していない）。c12-p0#0のNode sampled max heapUsed 4.35〜4.42 GiBは、D2-bが記録したpage realmの jsHeapSizeLimit 約4.09 GiB（Worker上限と同一視しない参考値）を上回っており、Browserで完走する保証はない。',
    '「memory issue solved」とは言えない。H1後のpeakを構成する保持構造（frontier・result history・windows memo・generated burstの比率）はheap profileで局在化していない。',
    'Production UXとして十分に速いとは言えない。c12-p0#0はCandidateなしのextent stopまで約14.5〜15分、c2-p1#0はfirst Candidateまで約5分かかった。',
    '実Planner Alternative trial全体（複数Target・複数trial・full Planner rerun）のmemory / runtimeは測定していない（本PhaseはSearch-only）。',
    'c12-p0#0でextent内にIdeal Candidateが無いことが、Issue #154のPlan全体の可否に対して何を意味するかは本Phaseの対象外である。',
  ],
  limitations: [
    'process.memoryUsage()は1 s heartbeat / snapshot時点のsampled maximumであり、true peakではない。',
    '各(context, mode)は1 run。wall timeは同一マシン上の参考値で、別プロセス（既存のvite preview server 2組）が起動していた。',
    'D2-cの値はsampling heap profilerを付けたchildのもので、reference列としてのみ示した。',
    'minimal modeはSearch instrumentationを持たないのでprogress（depth・generated）を記録しない。',
    'non-formal smoke（primary 2件・minimalのみ・4分budget、未commit code）はcontract error / 即OOMの検出だけに使い、formal結果・selection・budgetに使っていない。',
  ],
  nextPhaseRecommendation: {
    primary: 'Phase 2-C2.5-D2-e: H1後のChrome Dedicated Worker正式再測定（D2-bと同じ5 context・同じdriver条件）。Node 8 GBで両primaryが完走したので、次はBrowserで同じ入力がrenderer lossせず完走するかを確認する。特にc12-p0#0はNode sampled max 4.35〜4.42 GiBでBrowserの参考上限付近にある。',
    secondary: 'Browserでc12-p0#0が失われる、またはruntimeを短縮する必要がある場合は、H1後のheap localization（c12-p0#0のpeak時点の保持構造: frontier / result history / windows memo / generated burst）と、1 depthあたり最大約196万state（8 stream合算）を生成するgeneration量・時間（H6、stream間で一致するgenerated列）の分析を行う。H2（steps[] lazy化）はH1のedge-cutにほぼ含まれていたため、単独の優先度は低い。',
    notRecommended: 'Search extent（Gogma 235）やProduction defaultの変更は、本Phaseの結果だけでは推奨しない。',
  },
} as const
