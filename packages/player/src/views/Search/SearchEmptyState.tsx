import { Search } from 'lucide-react';
import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { EmptyState } from '@nuclearplayer/ui';

export const SearchEmptyState: FC = () => {
  const { t } = useTranslation('search');

  return (
    <EmptyState
      data-testid="search-empty-state"
      icon={<Search size={48} />}
      title={t('empty-state')}
      description={t('empty-state-description')}
      className="flex-1"
    />
  );
};
