import { CenteredMessage } from '@/components/CenteredMessage';

export default function NotFound() {
  return (
    <CenteredMessage
      title="Consent not found"
      body="It may have been removed, or the link is wrong."
      action={{ label: 'Back to your consents', href: '/consents' }}
    />
  );
}
