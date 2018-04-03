CREATE TABLE `circle` (
  `id` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `timestamp` bigint(20) NOT NULL,
  `created` bigint(20) NOT NULL,
  `title` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` int(11) NOT NULL,
  `betrayed` tinyint(1) NOT NULL,
  `outside` int(11) NOT NULL,
  `websocket` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `author` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `authorBetrayer` tinyint(1) NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `circlestatus` (
  `id` int(11) NOT NULL,
  `circle` varchar(16) NOT NULL,
  `timestamp` bigint(20) NOT NULL,
  `score` int(11) NOT NULL,
  `betrayed` tinyint(1) NOT NULL,
  `outside` int(11) NOT NULL,
  `authorBetrayer` tinyint(1) NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

DELIMITER $$
CREATE TRIGGER `UpdateCircle` AFTER INSERT ON `circlestatus` FOR EACH ROW UPDATE `circle` SET `score` = NEW.`score`, `betrayed` = NEW.`betrayed`, `outside` = NEW.`outside`, `authorBetrayer` = NEW.`authorBetrayer` WHERE `id` = NEW.`circle`
$$
DELIMITER ;

ALTER TABLE `circle`
  ADD PRIMARY KEY (`id`) USING BTREE;

ALTER TABLE `circlestatus`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `circleID` (`circle`,`score`,`betrayed`,`outside`,`authorBetrayer`);

ALTER TABLE `circlestatus`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
