import { useState, type RefObject } from 'react';
import { Box, IconButton, InputBase, Tooltip } from '@wso2/oxygen-ui';
import { ArrowUp, Plus } from '@wso2/oxygen-ui-icons-react';

export function ChatInput({
  disabled,
  onSend,
  inputRef,
  placeholder,
}: {
  disabled: boolean;
  /** One of the example questions; see placeholderFor. */
  placeholder: string;
  onSend: (text: string) => void;
  /** Lets the panel hand focus back here once the assistant has replied, so a
   * follow-up needs no click. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [value, setValue] = useState('');

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'background.paper',
        // An input, so the input radius the theme gives text fields.
        borderRadius: '8px',
        pl: 0.5,
        pr: 2,
        py: 0.5,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Attachments are not wired up yet: the button is here so the panel
          already has its final shape, and does nothing when pressed. */}
      <Tooltip title="Add files">
        <IconButton type="button" aria-label="Add files" size="small" sx={{ color: 'text.secondary' }}>
          <Plus size={18} />
        </IconButton>
      </Tooltip>
      <InputBase
        inputRef={inputRef}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        sx={{ fontSize: 14, width: '100%', py: 0.5 }}
      />
      <IconButton
        type="button"
        onClick={submit}
        aria-label="Send"
        disabled={disabled || !value.trim()}
        sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}
      >
        <ArrowUp size={18} />
      </IconButton>
    </Box>
  );
}
