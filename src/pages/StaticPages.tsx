import { useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

export function RngSetupPage() {
  return <PageShell title="RNG Setup" description="RNG状態を項目ごとに設定・確認します。" />
}

export function NormalCountersPage() {
  return <PageShell title="Normal Counters" description="通常アーティアの武器種・レア度別Counterを特定します。" />
}

export function OwnedWeaponsPage() {
  return <PageShell title="Owned Weapons" description="所持している巨戟アーティアを1本ずつ管理します。" />
}

export function TargetWeaponsPage() {
  return <PageShell title="Target Weapons" description="欲しい完成武器の理想条件と実用条件を管理します。" />
}

export function ProductionPlanPage() {
  const { planId } = useParams()
  return <PageShell title="Production Plan" description={`作成計画（${planId ?? '未指定'}）の全体を確認します。`} />
}

export function ExecutionNavigatorPage() {
  const { planId } = useParams()
  return <PageShell title="Execution Navigator" description={`作成計画（${planId ?? '未指定'}）を1操作ずつ進めます。`} />
}
