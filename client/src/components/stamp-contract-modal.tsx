import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, UploadCloud, X } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  fetchBlobUrl,
  fetchBytes,
  listSeals,
  stampContract,
  uploadSeal,
  type GeneratedContract,
  type Seal,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  contract: GeneratedContract | null
  onClose: () => void
  onStamped: () => void
}

const RENDER_WIDTH = 520 // largura de render da página (px); coordenadas 1:1 com o canvas
const MARGIN = 20 // margem do posicionamento default (px no canvas)

// Caixa da chancela em px, relativa ao canvas. A altura segue a proporção da imagem.
type Box = { left: number; top: number; width: number; height: number }

export function StampContractModal({ contract, onClose, onStamped }: Props) {
  const { t } = useTranslation()
  const open = contract !== null

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const aspectRef = useRef(0.4) // altura/largura da chancela; atualizado ao carregar a imagem
  const drag = useRef<null | { mode: 'move' | 'resize'; dx: number; dy: number }>(null)

  const [seals, setSeals] = useState<Seal[]>([])
  const [sealUuid, setSealUuid] = useState('')
  const [sealUrl, setSealUrl] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  // Carrega as chancelas ao abrir.
  useEffect(() => {
    if (!open) return
    listSeals().then(setSeals).catch(() => setSeals([]))
  }, [open])

  // Reseta ao (re)abrir para um contrato.
  useEffect(() => {
    if (!contract) return
    setSealUuid('')
    setSealUrl(null)
    setBox(null)
    setCanvasSize(null)
  }, [contract])

  // Renderiza a ÚLTIMA página do PDF no canvas.
  useEffect(() => {
    if (!contract) return
    let cancelled = false
    setLoadingPdf(true)
    ;(async () => {
      try {
        const bytes = await fetchBytes(`/storage/download/${contract.id}?name=${encodeURIComponent(contract.name)}`)
        if (cancelled) return
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
        const last = pdf.numPages
        setPageIndex(last - 1)
        const page = await pdf.getPage(last)
        const base = page.getViewport({ scale: 1 })
        const scale = RENDER_WIDTH / base.width
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas }).promise
        if (cancelled) return
        setCanvasSize({ w: viewport.width, h: viewport.height })
      } catch {
        if (!cancelled) toast.error(t('templates.stamp.error'))
      } finally {
        if (!cancelled) setLoadingPdf(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [contract, t])

  // Ao escolher uma chancela: carrega a imagem (blob autenticado) e sua proporção,
  // e posiciona a caixa por padrão no canto inferior-direito.
  useEffect(() => {
    if (!sealUuid) return
    const seal = seals.find((s) => s.uuid === sealUuid)
    if (!seal) return
    let url: string | null = null
    fetchBlobUrl(`/storage/download/${seal.itemId}?name=${encodeURIComponent(seal.name)}`)
      .then((u) => {
        url = u
        setSealUrl(u)
        const img = new Image()
        img.onload = () => {
          aspectRef.current = img.naturalHeight / img.naturalWidth || 0.4
          placeDefault()
        }
        img.src = u
      })
      .catch(() => toast.error(t('templates.stamp.error')))
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealUuid, seals])

  // Reposiciona o default quando o canvas fica pronto e já há chancela.
  useEffect(() => {
    if (canvasSize && sealUrl) placeDefault()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize])

  function placeDefault() {
    const cs = canvasSize
    if (!cs) return
    const width = cs.w * 0.28
    const height = width * aspectRef.current
    setBox({
      left: cs.w - width - MARGIN,
      top: cs.h - height - MARGIN,
      width,
      height,
    })
  }

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

  function onPointerDown(e: React.PointerEvent, mode: 'move' | 'resize') {
    e.preventDefault()
    e.stopPropagation()
    if (!box) return
    drag.current =
      mode === 'move'
        ? { mode, dx: e.clientX - box.left, dy: e.clientY - box.top }
        : { mode, dx: e.clientX - box.width, dy: 0 }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    const cs = canvasSize
    if (!d || !box || !cs) return
    if (d.mode === 'move') {
      setBox({
        ...box,
        left: clamp(e.clientX - d.dx, 0, cs.w - box.width),
        top: clamp(e.clientY - d.dy, 0, cs.h - box.height),
      })
    } else {
      const width = clamp(e.clientX - d.dx, 40, cs.w - box.left)
      setBox({ ...box, width, height: width * aspectRef.current })
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    drag.current = null
    try {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  async function onUpload(file: File) {
    setUploading(true)
    try {
      const seal = await uploadSeal(file)
      toast.success(t('templates.stamp.uploadSuccess'))
      const next = await listSeals()
      setSeals(next)
      setSealUuid(seal.uuid)
    } catch {
      toast.error(t('templates.stamp.uploadError'))
    } finally {
      setUploading(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  async function onApply() {
    if (!contract || !box || !canvasSize || !sealUuid) return
    setApplying(true)
    try {
      await stampContract(contract.id, {
        sealUuid,
        xFrac: box.left / canvasSize.w,
        yFracTop: box.top / canvasSize.h,
        widthFrac: box.width / canvasSize.w,
        page: pageIndex,
        name: contract.name,
      })
      toast.success(t('templates.stamp.success'))
      onStamped()
      onClose()
    } catch {
      toast.error(t('templates.stamp.error'))
    } finally {
      setApplying(false)
    }
  }

  if (!open || !contract) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-background shadow-xl">
        <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <button type="button" onClick={onClose} aria-label="voltar" className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{t('templates.stamp.title')}</h2>
            <p className="truncate text-xs opacity-80">{contract.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="fechar" className="ml-auto shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {/* Seletor + upload de chancela */}
          <div className="grid gap-1.5">
            <Label htmlFor="seal-select">{t('templates.stamp.chooseSeal')}</Label>
            <div className="flex gap-2">
              <select
                id="seal-select"
                value={sealUuid}
                onChange={(e) => setSealUuid(e.target.value)}
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t('templates.stamp.selectSeal')}</option>
                {seals.map((s) => (
                  <option key={s.uuid} value={s.uuid}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => uploadRef.current?.click()}>
                {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1 h-4 w-4" />}
                {t('templates.stamp.upload')}
              </Button>
              <input
                ref={uploadRef}
                type="file"
                accept=".png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                }}
              />
            </div>
            {seals.length === 0 && <p className="text-xs text-muted-foreground">{t('templates.stamp.noSeals')}</p>}
          </div>

          <p className="text-xs text-muted-foreground">{t('templates.stamp.hint')}</p>

          {/* Preview da última página com a chancela sobreposta */}
          <div className="flex justify-center overflow-auto rounded-md border bg-muted/40 p-3">
            <div className="relative" style={{ width: canvasSize?.w, height: canvasSize?.h }}>
              <canvas ref={canvasRef} className="block rounded shadow-sm" />
              {loadingPdf && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('templates.stamp.loadingPdf')}
                </div>
              )}
              {box && sealUrl && (
                <div
                  className="absolute cursor-move touch-none select-none ring-2 ring-primary/70"
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                  onPointerDown={(e) => onPointerDown(e, 'move')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  <img src={sealUrl} alt="chancela" className="h-full w-full object-contain opacity-80" draggable={false} />
                  <div
                    className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-primary"
                    onPointerDown={(e) => onPointerDown(e, 'resize')}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                </div>
              )}
            </div>
          </div>

          <Button type="button" className="w-full" disabled={applying || !box || !sealUuid} onClick={onApply}>
            {applying ? t('templates.stamp.applying') : t('templates.stamp.apply')}
          </Button>
        </div>
      </div>
    </div>
  )
}
