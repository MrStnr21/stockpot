-- SPDX-License-Identifier: AGPL-3.0-or-later
-- SPDX-FileCopyrightText: 2026 The stockpot authors

INSERT INTO categories (position, name, format, icon, color, instructions) VALUES
	(0, 'English', 'vocabulary', 'english', 'english', ''),
	(1, 'AI', 'comparison', 'ai', 'ai', ''),
	(2, 'Technology', 'technology', 'tech', 'tech', ''),
	(3, 'Concept', 'concept', 'concept', 'concept', ''),
	(4, 'Idea', 'report', 'idea', 'idea', ''),
	(5, 'Other', 'brief', 'other', 'other', '')
ON CONFLICT (name) DO NOTHING;
