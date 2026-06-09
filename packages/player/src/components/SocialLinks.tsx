import { openUrl } from '@tauri-apps/plugin-opener';
import { FC } from 'react';
import { LuGlobe } from 'react-icons/lu';
import { SiGithub } from 'react-icons/si';

import { Button, Tooltip } from '@nuclearplayer/ui';

const SOCIAL_LINKS = [
  {
    label: 'GitHub',
    icon: <SiGithub size={16} />,
    url: 'https://github.com/shnwazdeveloper/laya-music',
  },
  {
    label: 'Developer',
    icon: <LuGlobe size={16} />,
    url: 'https://github.com/shnwazdeveloper',
  },
] as const;

export const SocialLinks: FC = () => (
  <div className="flex items-center gap-1">
    {SOCIAL_LINKS.map((link) => (
      <Tooltip key={link.label} content={link.label} side="top">
        <Button variant="text" size="icon-sm" onClick={() => openUrl(link.url)}>
          {link.icon}
        </Button>
      </Tooltip>
    ))}
  </div>
);
