﻿class StateIcon {

    static template = `
        <div class="state-icon {{ ::$ctrl.className }}">
            <umb-icon icon="icon-{{ ::$ctrl.icon }}"></umb-icon>
        </div>`;

    icon = 'power';
    className = 'disabled';

    $onInit() {
        if (!this.disabled) {
            this.icon = this.failed ? 'delete' : 'check';
            this.className = this.failed ? 'fail' : 'pass';
        }
    };
}

export const StateIconComponent = {
    transclude: true,
    name: 'preflightStateIcon',
    bindings: {
        failed: '<',
        disabled: '<'
    },
    template: StateIcon.template,
    controller: StateIcon,
};
