/**
 * Issue #154 Phase 2-C2.5-D2-c: the document-level reading of the formal evidence, Research only. Never import from
 * Production.
 *
 * It is written AFTER the formal run and the post-hoc analysis (it is one of the files the analyzer allows to change
 * after the measured HEAD). Before that it is `null`, and the analyzer writes the evidence without an interpretation.
 * It never changes a measure, a level or the mechanical recommendation; it only reads them. Every number below is one
 * the formal evidence records (c12 / c2 = the two primary OOM contexts, in workload order).
 */
export const PHASE2C25D2C_INTERPRETATION: null | {
  writtenAfterFormalEvidence: true
  formalConclusions: string[]
  notYetClaimable: string[]
  limitations: string[]
  recommendation: {
    candidate: string
    reduces: string
    mustKeep: string[]
    semanticImpact: { lateDepthRead: string; sameResultLaterPosition: string; absolutePosition: string; amendmentHistory: string; candidateComposition: string
      notice: string; extentAndExhausted: string; prediction: string }
    notImplementedInThisPhase: true
  }
} = {
  writtenAfterFormalEvidence: true,
  formalConclusions: [
    'D2-a effect validation: 旧C2.5-Cでmajorだった scheduler channel.retained・bonusAmendmentOperations・Candidate semantic key（retentionKey / bonusKey / operationTypeKey と比較）、contributingだった bonusAmendmentResults は、post-D2の両primary contextでsnapshot edge-cut 0.0%・jit_default / no_inlining sampling 0.0%（not_observed）になった。同じD2-c規則で旧C2.5-C raw artifactを再解析すると major / major / major / contributing（c12 / c2: channel.retained edge-cut 14.3% / 55.5%、key 37.2% / 30.5%、jit_default scheduler publication 29.2% / 30.8%）であり、D2-aはこれらを主要因から外した。',
    'post-D2のProduction-like JIT（jit_default、yield点で到達した最高threshold 6,144 MiB）では、live sampled bytesの100.0% / 100.0%（inclusive）が held-aware Bonus stream の ensureReserved() 上にあり、attributedでは ensureReserved 63.6% / 65.9%（map callback内に inline された reservedBonusSteps を含む）、reservedGeneratedState 34.5% / 33.6%、reservedBonusSteps 1.8% / 0.4%。scheduler settle は 0.0%。',
    'no_inlining diagnostic variant（7,168 MiB）でのallocation attribution: reservedBonusSteps 45.5% / 46.7%、reservedGeneratedState 33.8% / 33.5%、ensureReserved 20.4% / 19.5%、keepFamilyLayoutKey 0.1% / 0.3%。これはProduction-like heapの関数別割合ではない。',
    '512 MB near-limit snapshotでは、新規bytes（456.0 / 449.0 MiB）の68.8% / 86.5%がTargetSearchSchedulerから到達するpersistent、31.2% / 13.5%がin-flight。set.depthsのedge-cutは64.5% / 69.4%（全量persistent）。snapshot時点の全depth配列の要素数（791,165 / 991,242）は、そのrunの累積generated state数（791,165 / 991,242）と一致し、過去depthの全raw stateがpublished raw solutionとして保持されている。',
    'published raw solution 1件あたりの保持（snapshot shallow size、c12）: solution object 72 B、steps[]（JSArray 約32 B + backing store 約160 B。要素3〜4件でもpushで確保したcapacityのまま）約192 B、ReservedBonusResultNode 56 B、result object 40 B、step object 40 B。steps[]単独のedge-cutは38.3% / 38.8%、results / previous history 21.1% / 24.7%。',
    '事前登録規則（snapshot measure + jit_default sampling）の判定: H1 set.depths strong（両context）、H2 steps[] strong（両context）、H3 result history contributing、H6 generated burst contributing（12.4% / 12.0%、in-flight）、H5 frontier minor（1.2% / 1.2%）、H7 publication intermediate minor（c12 contributing 11.4% / c2 minor 0.4%）、H9 layout key minor（c12 contributing 7.2% / c2 minor 4.9%、ほぼin-flight）、H4 channel.retained not_supported（0.0%）、H8 windows / prediction memo not_supported（0.4% / 0.3%）。',
    '機械的recommendation（事前登録規則）: primary H1（set.depths、min snap 64.5%）、secondary H2（steps[]、min snap 38.3%）。',
    'c12とc2の残存原因は同じ: jit_defaultの最大attributed関数（ensureReserved）と最大category（reserved_generation）が一致し、H7 / H9以外の判定が一致した。H7 / H9の差はsnapshot取得の瞬間の違いで、c12はgenerated.map()の途中（in-flight generated 242,468 state + map store 204,895 solution）、c2はgenerated生成直後（in-flight generated 156,878 state、map store 2,095 solution）だった。',
    '1回のensureReserved()（1 stream・1 depth）で生成されるraw stateは最大246,039 / 157,070。D2-aの「depth 3で1,964,741 / 1,256,560」は、同じdepthの8本のheld-aware Bonus stream（Route baseごと）の合算である。c12は8本中7本、c2は8本すべてが、共通depthでgenerated数の列が一致した（観察。事前登録した判定ではない）。',
    'OOMまでの進行はD2-aと同一だった（jit_default: c12 Gogma depth 12・累積generated 17,403,169・累積frontier 546,316、c2 depth 18・17,267,064・652,568）。V8の最後のMark-Compactは6,916.2 / 6,818.3 MB（committed 8,314.8 / 8,259.9 MB）で、jit_defaultの7,168 MiB thresholdはyield点に一度も到達しなかった（out_of_memory_before_threshold）。',
    'cleared reference（c0-p0#0）はpost-D2のjit_defaultで stopped_by_extent_before_candidate（Gogma depth 233、4,096 MiBまで到達、D2-aとsemantic parity）。上位はensureReserved 99.5%（旧C2.5-Cはdepth 134でOOM、settle 67.0%）。shallow問題の直接証拠には使わない。',
    'profilerはSearchのsemantic outputを変えていない: controls 2 context × 2 variant と cleared reference 1 runでstatus・Search summary・first Candidate key・extent / exhaustedがD2-aと一致した（contaminated 0 / 5）。no_inliningのheap-allocation parityは主張しない。',
  ],
  notYetClaimable: [
    '8 GB到達時点の保持構造そのもの。snapshotは512 MB heapで取得した（c12はGogma depth 3付近、c2は4付近）。8 GB時点は、jit_defaultでensureReserved由来が100%であることと、累積generated = published raw solution数（snapshotで確認）から読んだもので、8 GB snapshotではない。',
    'set.depthsの長期保持をやめるだけでc12 / c2がOOMせずに終わるかどうか。Searchはより深いdepthへ進み、同じdepthの8 streamの生成・frontier・in-flight burst（1 stream-depthで約24.6万 state）が次の上限になり得る。',
    'memory改善後のruntime。OOMまで約90秒で累積約1,740万stateを生成しており、extent（Gogma 235）まで進む場合の計算量は測っていない。',
    '8本のheld-aware Bonus streamでReset由来のstateが重複して生成・保持されているかどうか（generated数の一致は観察であり、state内容の同一性やstream間共有のsemantic妥当性は未検証）。',
    'Chrome Dedicated Worker内での同じ内訳（本Phaseの計測はNodeのみ）。',
    'no_inliningとjit_defaultのheap-allocation parity。',
  ],
  limitations: [
    'sampling bytesはV8の統計的推定値（256 KiB間隔）。jit_defaultではinline展開されたcallee（reservedBonusSteps、keepFamilyLayoutKey等）の割り当てが呼び出し元（ensureReservedのmap callback、reservedGeneratedState）に計上される。',
    'jit_defaultの最高profileは6,144 MiB（7,168 MiBはyield点で未到達のままOOM）。仮説判定のjit_default measureは6,144 MiBの値である。',
    'snapshotは512 MB heapでの1枚で、取得瞬間（c12はmap途中、c2は生成直後）によってin-flightの内訳が変わる。H6 / H7のin-flight measureはその瞬間の値である。',
    'edge-cut sizeはdominator treeのretained sizeではない。共有object（bonuses配列、result history）はどの単独edge-cutにも入らず、仮説間の値は合算しない（H1はH2の大部分を含む）。',
    '判定閾値（25% / 10% / 5% / 0.5% / 1%）とrecommendation規則はD2-c計測前に固定しSHA-256をformal runに記録した。holder signature、array censusのFixedArray対応、layout key文字列のNUL / 空白正規化は、non-formal smoke snapshot 1枚で監査してからformal runを行った。',
    '旧C2.5-C比較は、committed C2.5-C RESULTのmanifestとSHA-256一致を確認した旧raw artifactを、D2-cの同じ規則で再解析したもの。旧snapshotの取得瞬間（scheduler publication途中）はpost-D2と異なる。',
    'stream構成（8本、generated数の一致）はprogress observerのper-depth countから導いた観察で、事前登録した判定ではない。',
    '各条件1 run。反復・分散は取っていない。profiling runのwall timeは性能指標ではない。',
  ],
  recommendation: {
    candidate: 'H1: held-aware Bonus stream（createTargetBonusStream().ensureReserved()）が、各depthの全raw solution（solution object + steps[] + そのsolutionだけが参照するresult history）を set.depths に全past depth分保持し続ける表現をやめる。Production consumer（TargetSearchScheduler.bonusChannelの1 channel）はstream keyごとに各depthを昇順に1回だけ読み、読んだ後の配列を再読しないので、depthを読み手へ渡した後にそのraw solutionを保持しない表現（生成済みdepth数・frontier・windows・unsupported・done・cutByExtentだけを保持）へ変える。実装は次Phase。',
    reduces: 'past depthのpublished raw solution。512 MB snapshotでset.depthsのedge-cutは新規bytesの64.5% / 69.4%で、published raw solution 1件あたり約400 B（うちsteps[]約192 B）。8 GB近くのOOM時点ではjit_defaultのlive sampled bytesの100%がensureReserved由来で、累積generated（約1,740万）がすべてpublished raw solutionとして残っている。H2（steps[]）はH1のedge-cutにほぼ含まれるので、H1を採る場合H2を同時に実装しない。',
    mustKeep: [
      'readReservedDepth(base, depth)がProduction consumerへ返すraw solutionの集合・順序・内容（depth / lastResetDepth / bonuses / scope / results / steps）',
      '各depthのraw solutionすべてからのroute_kind notice、unsupported prediction notice',
      'frontier（(position, familyLayoutKey)ごとの代表）と、そのstateのresult history chain（後続stateのprevious、Ideal solutionのamendmentResultsとstepsの導出元）',
      'reservation window memo、Reset / Keep prediction memo',
      'extent / exhausted判定（生成済みdepth数、frontierのwindow、cutByExtent）',
      'scheduler側のIdeal-only publication、channel.retained、Lazy Ideal Cross',
      'readReservedDepthを同じdepthで再度・順不同で呼ぶテストや将来のconsumerへの扱い（黙って空配列を返さず、契約として明示するかfail closedにする）',
    ],
    semanticImpact: {
      lateDepthRead: 'Productionではstream keyごとに1 channelだけが各depthを昇順に1回読み、後から登録されるRoute baseはchannel.retained（Ideal positionのみ）を受け取りdepthを再読しない。過去depthを保持しない表現では、同じdepthの再読・順不同の読み出しを黙って空にせず、契約として禁止（fail closed）するか再生成で同じ結果を返す必要がある。',
      sameResultLaterPosition: '各absolute positionは引き続き独立したraw solutionとして、そのdepthの読み出しで1回ずつ提示される。生成とfrontier reductionは変えないので、後方の同一結果positionの扱いは変わらない。',
      absolutePosition: 'stepsのabsolute Gogma positionはresult history（step node）から読み出し時に導出する。保持をやめても読み出し時点の値は同じ。',
      amendmentHistory: 'frontier stateとIdeal solution（publication時にoperations / amendmentResultsへmaterializeされchannel.retainedに残る）のresult chainは保持する。非Ideal raw solutionだけが参照するresult nodeはGC対象になるが、どのCandidateの履歴にも使われない。',
      candidateComposition: 'Lazy Ideal Crossはchannel.retainedだけを読むので変わらない。',
      notice: 'route_kind / unsupported noticeは各depthの全raw solutionを読み出し時に1回見て作るので、読み出し時点で全件を渡せば変わらない。',
      extentAndExhausted: 'exhaustedは「生成済みdepth数 <= depth」とfrontierのwindow、stopped by extentはcutByExtentから決まる。保持配列の長さではなく生成済みdepth数を持てば変わらない。',
      prediction: 'Reset / Keep predictionはmemoとfrontierから行い、過去depthの再生成を要しないので、prediction回数・順序は変わらない（再読を再生成で満たす設計にした場合を除く）。',
    },
    notImplementedInThisPhase: true,
  },
}
