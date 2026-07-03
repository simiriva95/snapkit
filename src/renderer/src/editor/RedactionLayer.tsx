import { Group, Label, Rect, Tag, Text } from 'react-konva'
import { useEditorStore } from '@renderer/stores/editor'

/**
 * Review overlay for auto-redaction proposals: dashed boxes the user can
 * toggle with a click before applying the blur.
 */
function RedactionLayer(): React.JSX.Element | null {
  const status = useEditorStore((s) => s.redactionStatus)
  const proposals = useEditorStore((s) => s.proposals)
  const toggle = useEditorStore((s) => s.toggleProposal)

  if (status !== 'review' || proposals.length === 0) return null

  return (
    <>
      {proposals.map((p) => (
        <Group key={p.id} onClick={() => toggle(p.id)} onTap={() => toggle(p.id)}>
          <Rect
            x={p.x}
            y={p.y}
            width={p.width}
            height={p.height}
            stroke={p.active ? '#ef4444' : '#9ca3af'}
            strokeWidth={2}
            dash={[6, 4]}
            fill={p.active ? 'rgba(239,68,68,0.15)' : 'rgba(0,0,0,0)'}
            opacity={p.active ? 1 : 0.6}
          />
          <Label x={p.x} y={p.y - 22} opacity={p.active ? 1 : 0.5} listening={false}>
            <Tag fill={p.active ? '#ef4444' : '#9ca3af'} cornerRadius={3} />
            <Text
              text={p.label}
              fontSize={12}
              padding={4}
              fill="#ffffff"
              fontFamily="Helvetica Neue, Helvetica, Arial, sans-serif"
            />
          </Label>
        </Group>
      ))}
    </>
  )
}

export default RedactionLayer
