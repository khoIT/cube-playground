import { Input, Select, Space, Text, TextArea } from '@cube-dev/ui-kit';
import { Key } from 'react';
import { NewMetricDraft, Format } from '../types';
import { ValidationResult } from '../types';
import { TagCombo } from '../components/tag-combo';
import { useExistingTags } from '../hooks/use-existing-tags';

interface IdentitySectionProps {
  draft: NewMetricDraft;
  setField: <K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) => void;
  validation: ValidationResult;
}

const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: 'number',   label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent',  label: 'Percent' },
];

/**
 * Section 5 — Identity: name (snake_case), title, description, format.
 * Shows inline validation errors from the shared validation result.
 */
export function IdentitySection({ draft, setField, validation }: IdentitySectionProps) {
  const nameError = validation.errors.name;
  const titleError = validation.errors.title;
  const tagsError = validation.errors.tags;
  const existingTags = useExistingTags();

  return (
    <Space direction="vertical" gap="1.5x">
      <Text>Identity</Text>

      {/* Metric name — snake_case identifier used in YAML */}
      <Space direction="vertical" gap=".5x">
        <Text>Name (snake_case)</Text>
        <Input
          aria-label="Metric name"
          placeholder="e.g. active_users_count"
          value={draft.name}
          onChange={(value: string) => setField('name', value)}
          size="medium"
          validationState={nameError && draft.name ? 'invalid' : undefined}
        />
        {nameError && draft.name !== '' && <Text>{nameError}</Text>}
      </Space>

      {/* Human-readable title shown in the UI */}
      <Space direction="vertical" gap=".5x">
        <Text>Title</Text>
        <Input
          aria-label="Metric title"
          placeholder="e.g. Active Users"
          value={draft.title}
          onChange={(value: string) => setField('title', value)}
          size="medium"
          validationState={titleError && draft.title !== '' ? 'invalid' : undefined}
        />
        {titleError && draft.title !== '' && <Text>{titleError}</Text>}
      </Space>

      {/* Optional free-text description — rendered only as plain text in YAML */}
      <Space direction="vertical" gap=".5x">
        <Text>Description (optional)</Text>
        <TextArea
          aria-label="Metric description"
          placeholder="What does this metric measure?"
          value={draft.description}
          onChange={(value: string) => setField('description', value)}
          rows={3}
        />
      </Space>

      {/* Tags — free-form chip combo with suggestions from existing measures */}
      <Space direction="vertical" gap=".5x">
        <Text>Tags (optional)</Text>
        <TagCombo
          value={draft.tags}
          onChange={(next) => setField('tags', next)}
          suggestions={existingTags}
          error={tagsError}
        />
      </Space>

      {/* Display format */}
      <Space direction="vertical" gap=".5x">
        <Text>Format</Text>
        <Select
          aria-label="Display format"
          selectedKey={draft.format}
          onSelectionChange={(key: Key) => setField('format', key as Format)}
          size="medium"
        >
          {FORMAT_OPTIONS.map(({ value, label }) => (
            <Select.Item key={value} textValue={label}>
              {label}
            </Select.Item>
          ))}
        </Select>
      </Space>
    </Space>
  );
}
