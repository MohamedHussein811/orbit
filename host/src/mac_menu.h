// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.

#ifndef ORBIT_HOST_MAC_MENU_H_
#define ORBIT_HOST_MAC_MENU_H_

namespace orbit {

// Builds the Mac menu bar. Chromium finds browser keyboard shortcuts on macOS through this menu,
// so without it shortcuts such as Command-T do nothing.
void InstallMainMenu();

}  // namespace orbit

#endif  // ORBIT_HOST_MAC_MENU_H_
